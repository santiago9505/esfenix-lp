/**
 * Scoped maintenance of the existing Fresa flower catalogs.
 * Dry run by default. Credentials stay in the supplied Fresa installation.
 * Usage: node scripts/sync-fresa-flower-images.mjs --fresa-project <path> [--apply]
 */
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { normalizeCatalog } from '../src/catalog/core/fresa-catalog.js';
import { applyLocalProductImageFallbacks, LOCAL_VARIANT_IMAGE_FALLBACK_PRODUCT_IDS } from '../src/catalog/core/local-image-fallback.js';
import { flowerIdentity, flowerRows, missingFranchiseFlowers, sharedFlowerImages } from './lib/shared-flower-images.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const project = args[args.indexOf('--fresa-project') + 1];
if (!args.includes('--fresa-project') || !project) throw new Error('Supply --fresa-project with the existing Fresa installation.');
const apply = args.includes('--apply');
const require = createRequire(path.resolve(project, 'package.json'));
const { createClient } = require('@supabase/supabase-js');
const fresaEnv = loadEnv('development', path.resolve(project), ['NEXT_PUBLIC_SUPABASE_', 'SUPABASE_']);
if (!fresaEnv.NEXT_PUBLIC_SUPABASE_URL || !fresaEnv.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Fresa storage credentials are not configured.');
const db = createClient(fresaEnv.NEXT_PUBLIC_SUPABASE_URL, fresaEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const env = loadEnv('development', root, 'FRESA_');
const sources = JSON.parse(env.FRESA_CATALOG_SOURCES || '[]');
const sourceFor = name => /^(texas|houston)$/i.test(name) ? 'houston' : String(name).toLowerCase();
const listsBySource = new Map(sources.map(source => [sourceFor(source.name), source.listId]));
for (const source of ['houston', 'seattle', 'dmv']) if (!listsBySource.get(source)) throw new Error(`Missing ${source} source.`);
const listIds = [...listsBySource.values()];
const check = async query => { const { data, error } = await query; if (error) throw error; return data; };
const lists = await check(db.from('lists').select('list_id,name,workspace_key,space_id,view_config').in('list_id', listIds));
if (lists.length !== sources.length || lists.some(list => list.workspace_key !== lists[0].workspace_key)) throw new Error('Catalog lists do not belong to one workspace.');
for (const source of sources) {
  if (lists.find(list => list.list_id === source.listId)?.name !== source.name) throw new Error('Catalog list identity changed.');
}
const workspace = lists[0].workspace_key;
const [workspaceRow] = await check(db.from('workspaces').select('workspace_key,name').eq('workspace_key', workspace));
if (!workspaceRow) throw new Error('Catalog workspace not found.');
const catalogNames = new Set(['type_product', 'category', 'product_family', 'variety', 'color', 'size_cm', 'sales_unit', 'active', 'location', 'product_image', 'cantidad mínima']);
const fields = (await check(db.from('custom_fields').select('field_id,list_id,workspace_key,field_name,field_type')
  .eq('workspace_key', workspace).in('list_id', listIds)))
  .filter(field => catalogNames.has(field.field_name.toLowerCase()));
const fieldsFor = listId => fields.filter(field => field.list_id === listId);
const fieldFor = (listId, name) => {
  const matches = fieldsFor(listId).filter(field => field.field_name.toLowerCase() === name);
  if (matches.length !== 1) throw new Error(`Missing or ambiguous ${name} field in ${listId}.`);
  return matches[0];
};
for (const listId of listIds) {
  if (fieldFor(listId, 'product_image').field_type !== 'attachments') throw new Error('Image field is not an attachment field.');
}
const auditDir = path.join(root, 'data/sources/shared-flower-images');
await fs.mkdir(auditDir, { recursive: true });
const journalFile = path.join(auditDir, 'journal.json');
let journal = { workspace, createdTasks: {}, uploads: {}, linkedTasks: {} };
try { journal = JSON.parse(await fs.readFile(journalFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (journal.workspace !== workspace) throw new Error('Journal belongs to a different workspace.');
let journalWrites = Promise.resolve();
const saveJournal = () => {
  const serialized = JSON.stringify(journal, null, 2);
  journalWrites = journalWrites.then(async () => {
    await fs.writeFile(`${journalFile}.tmp`, serialized);
    await fs.rename(`${journalFile}.tmp`, journalFile);
  });
  return journalWrites;
};
const columns = fields.filter(field => field.field_name.toLowerCase() !== 'cantidad mínima').map(field => ({ list_id: field.list_id, key: field.field_id, field_name: field.field_name,
  field_type: field.field_type, is_file: field.field_type === 'attachments' }));
let tasks, values, taskById, valuesByTask, imageSources;

async function paginate(makeQuery) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await check(makeQuery().range(offset, offset + 499));
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

async function readCatalog() {
  tasks = await paginate(() => db.from('tasks')
    .select('task_id,name,list_id,workspace_key,space_id,status,status_canonical,created_by,position,created_at,updated_at')
    .eq('workspace_key', workspace).in('list_id', listIds).is('parent_task_id', null).order('task_id'));
  values = await paginate(() => db.from('task_custom_field_values').select('value_id,task_id,field_id,value,updated_at')
    .eq('workspace_key', workspace).in('field_id', fields.map(field => field.field_id)).order('value_id'));
  taskById = new Map(tasks.map(task => [task.task_id, task]));
  valuesByTask = new Map();
  for (const row of values) {
    if (!taskById.has(row.task_id)) continue;
    if (!valuesByTask.has(row.task_id)) valuesByTask.set(row.task_id, new Map());
    valuesByTask.get(row.task_id).set(row.field_id, row);
  }
  imageSources = new Map();
  const normalized = normalizeCatalog({ catalog: { name: 'Landing Page', columns, products: tasks
    .filter(task => task.status_canonical === 'ACTIVA')
    .filter(task => task.list_id !== listsBySource.get('houston')
      || valuesByTask.get(task.task_id)?.get(fieldFor(task.list_id, 'active').field_id)?.value === true)
    .map(task => ({ id: task.task_id, name: task.name, listId: task.list_id,
      listName: lists.find(list => list.list_id === task.list_id).name, position: task.position,
      fields: Object.fromEntries([...(valuesByTask.get(task.task_id) ?? new Map())].map(([id, row]) => {
        if (id !== fieldFor(task.list_id, 'product_image').field_id) return [id, row.value];
        if (row.value != null && !Array.isArray(row.value)) throw new Error(`Unsupported attachment value on ${task.task_id}.`);
        return [id, (row.value ?? []).map(file => {
          const processedHash = String(file.path ?? '').split('/').pop().match(/^[a-f0-9]{12}-([a-f0-9]{12})-/i)?.[1];
          const key = file.contentKey || (processedHash ? `sha256-12:${processedHash.toLowerCase()}`
            : file.path ? `storage:list-attachments/${file.path}` : file.url);
          if (!key) throw new Error('An existing image has no storage path or URL.');
          imageSources.set(key, file);
          return { ...file, contentKey: key, url: key };
        })];
      })),
    })) } });
  return applyLocalProductImageFallbacks(normalized, { enabled: true, productIds: [],
    variantProductIds: LOCAL_VARIANT_IMAGE_FALLBACK_PRODUCT_IDS, categoryFallbacks: {} });
}

let products = await readCatalog();
const missing = missingFranchiseFlowers(products);
const photos = sharedFlowerImages(products);
const targets = ['houston', 'seattle', 'dmv'].flatMap(source => flowerRows(products, source)
  .filter(({ product, variant }) => photos.has(flowerIdentity(product, variant)))
  .filter(({ variant }) => !(valuesByTask.get(variant.sourceProductId)
    ?.get(fieldFor(taskById.get(variant.sourceProductId).list_id, 'product_image').field_id)?.value?.length)));
const report = { workspace: workspaceRow.name, dryRun: !apply, newDmvProducts: missing.length,
  stemLengthRowsWithoutOwnAttachment: targets.length,
  photographyBySource: Object.fromEntries(['houston', 'seattle', 'dmv'].map(source => [source,
    targets.filter(({ variant }) => taskById.get(variant.sourceProductId).list_id === listsBySource.get(source)).length])),
  newDmvFamilies: [...new Set(missing.map(({ product }) => product.name))] };
for (const images of sharedFlowerImages(products).values()) {
  for (const image of images) {
    const original = imageSources.get(image.contentKey || image.src);
    if (!original?.path && !String(image.src).startsWith('/assets/images/flowers-fallback/')) {
      throw new Error('Source photography is missing its Fresa storage path.');
    }
  }
}
await fs.writeFile(path.join(auditDir, 'plan.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!apply) process.exit(0);

// Back up only scoped catalog data before any remote write. Never overwrite it.
try {
  await fs.writeFile(path.join(auditDir, 'before.json'), JSON.stringify({ at: new Date().toISOString(), workspace,
    lists: lists.map(({ view_config: _config, ...list }) => list), fields, tasks, values }, null, 2), { flag: 'wx' });
} catch (error) { if (error.code !== 'EEXIST') throw error; }

const dmvList = lists.find(list => list.list_id === listsBySource.get('dmv'));
const template = tasks.find(task => task.list_id === dmvList.list_id && task.status_canonical === 'ACTIVA');
if (!template) throw new Error('DMV has no active task status to preserve.');
let nextPosition = Math.max(...tasks.filter(task => task.list_id === dmvList.list_id).map(task => task.position ?? 0)) + 1;
const newTasks = [];
const newValues = [];
for (const { product, variant } of missing) {
  const key = flowerIdentity(product, variant, { includeLength: true });
  // Save the id before inserting. A rerun reads that exact id after a timeout.
  journal.createdTasks[key] ??= randomUUID();
  const id = journal.createdTasks[key];
  const now = new Date().toISOString();
  newTasks.push({ task_id: id, workspace_key: workspace, list_id: dmvList.list_id,
      space_id: dmvList.space_id, name: variant.sourceProductName || product.name,
      description: 'DMV franchise catalog. Product availability and final conditions will be confirmed by our team.',
      status: template.status, status_canonical: 'ACTIVA', created_by: template.created_by,
      position: nextPosition++, created_at: now, updated_at: now });
  const sourceTask = taskById.get(variant.sourceProductId);
  const sourceValues = valuesByTask.get(sourceTask.task_id);
  const copied = [];
  // No accounting identifiers, prices, stock, formulas or relations are copied.
  for (const name of ['type_product', 'category', 'product_family', 'variety', 'color', 'size_cm', 'sales_unit', 'cantidad mínima']) {
    const sourceField = fieldsFor(sourceTask.list_id).find(field => field.field_name.toLowerCase() === name);
    const targetField = fieldsFor(dmvList.list_id).find(field => field.field_name.toLowerCase() === name);
    const value = sourceValues.get(sourceField?.field_id)?.value;
    if (targetField && value != null) copied.push({ workspace_key: workspace, task_id: id, field_id: targetField.field_id, value });
  }
  copied.push({ workspace_key: workspace, task_id: id, field_id: fieldFor(dmvList.list_id, 'location').field_id, value: 'DMV' },
    { workspace_key: workspace, task_id: id, field_id: fieldFor(dmvList.list_id, 'active').field_id, value: true });
  newValues.push(...copied);
}
await saveJournal();
for (let offset = 0; offset < newTasks.length; offset += 25) {
  const batch = newTasks.slice(offset, offset + 25);
  const existing = await check(db.from('tasks').select('task_id,list_id,workspace_key').in('task_id', batch.map(task => task.task_id)));
  if (existing.some(task => task.workspace_key !== workspace || task.list_id !== dmvList.list_id)) throw new Error('Created task identity mismatch.');
  await check(db.from('tasks').upsert(batch, { onConflict: 'task_id', ignoreDuplicates: true }));
  const ids = new Set(batch.map(task => task.task_id));
  await check(db.from('task_custom_field_values').upsert(newValues.filter(row => ids.has(row.task_id)),
    { onConflict: 'task_id,field_id', ignoreDuplicates: true }));
}
console.log(`Created or recovered ${missing.length} native DMV products.`);
products = await readCatalog();

// Activate existing DMV flowers as requested; stock and accounting data stay intact.
const houstonIdentities = new Set(flowerRows(products, 'houston').map(({ product, variant }) => flowerIdentity(product, variant, { includeLength: true })));
const activeRows = flowerRows(products, 'dmv').filter(({ product, variant }) => houstonIdentities.has(flowerIdentity(product, variant, { includeLength: true }))).flatMap(({ variant }) => {
  const fieldId = fieldFor(dmvList.list_id, 'active').field_id;
  return valuesByTask.get(variant.sourceProductId)?.get(fieldId)?.value === true ? []
    : [{ workspace_key: workspace, task_id: variant.sourceProductId, field_id: fieldId, value: true }];
});
if (activeRows.length) await check(db.from('task_custom_field_values').upsert(activeRows, { onConflict: 'task_id,field_id' }));

const bytesByImage = new Map();
async function imageBytes(image) {
  const key = image.contentKey || image.src;
  if (!bytesByImage.has(key)) bytesByImage.set(key, (async () => {
    const original = imageSources.get(key);
    if (original?.path) {
      if (!original.path.startsWith(`${workspace}/`)) throw new Error('Source image belongs to another workspace.');
      const { data, error } = await db.storage.from('list-attachments').download(original.path);
      if (error) throw error;
      return { bytes: Buffer.from(await data.arrayBuffer()), name: original.name, type: original.type };
    }
    if (String(image.src).startsWith('/assets/images/flowers-fallback/')) {
      const local = path.resolve(root, 'public', image.src.slice(1));
      const allowed = path.resolve(root, 'public/assets/images/flowers-fallback') + path.sep;
      if (!local.startsWith(allowed)) throw new Error('Invalid local image path.');
      return { bytes: await fs.readFile(local), name: path.basename(local), type: 'image/webp' };
    }
    throw new Error('Image is not in the authorized Fresa storage or approved local photography.');
  })());
  return bytesByImage.get(key);
}

const sourcePhotos = sharedFlowerImages(products);
const photoGroups = new Map();
for (const source of ['houston', 'seattle', 'dmv']) {
  for (const row of flowerRows(products, source)) {
    const key = `${source}:${flowerIdentity(row.product, row.variant)}`;
    if (!photoGroups.has(key)) photoGroups.set(key, []);
    photoGroups.get(key).push(row);
  }
}
// The existing adapter shares photos across lengths within a branch. Upload
// one native attachment per exact flower option rather than duplicate bytes
// on every stem length. Every branch still owns its own stored attachment.
const work = [...photoGroups.values()].flatMap(rows => {
  if (!sourcePhotos.has(flowerIdentity(rows[0].product, rows[0].variant))) return [];
  const hasNativePhoto = rows.some(({ variant }) => {
    const task = taskById.get(variant.sourceProductId);
    return valuesByTask.get(task.task_id)?.get(fieldFor(task.list_id, 'product_image').field_id)?.value?.length;
  });
  return hasNativePhoto ? [] : [rows.sort((a, b) => (a.variant.lengthCm ?? 0) - (b.variant.lengthCm ?? 0))[0]];
});
console.log(`Uploading ${work.length} exact flower photo groups; other stem lengths inherit within their branch.`);
let linked = 0;
async function photograph({ product, variant }) {
  const task = taskById.get(variant.sourceProductId);
  const fieldId = fieldFor(task.list_id, 'product_image').field_id;
  const originalValue = valuesByTask.get(task.task_id)?.get(fieldId)?.value ?? [];
  if (originalValue.length) return;
  const images = sourcePhotos.get(flowerIdentity(product, variant)) ?? [];
  if (!images.length) return;
  const attachments = [];
  for (const image of images) {
    const file = await imageBytes(image);
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
    const filename = `${sha256.slice(0, 16)}-${path.basename(file.name || 'flower.webp').replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const objectPath = `${workspace}/${task.list_id}/${task.task_id}/${filename}`;
    if (!journal.uploads[objectPath]) {
      const { error } = await db.storage.from('list-attachments').upload(objectPath, file.bytes,
        { contentType: file.type || 'image/webp', cacheControl: '3600', upsert: false });
      if (error && !/already exists|duplicate/i.test(error.message)) throw error;
      const downloaded = await db.storage.from('list-attachments').download(objectPath);
      if (downloaded.error) throw downloaded.error;
      if (createHash('sha256').update(Buffer.from(await downloaded.data.arrayBuffer())).digest('hex') !== sha256) throw new Error('Uploaded image verification failed.');
      journal.uploads[objectPath] = { sha256, size: file.bytes.length };
      await saveJournal();
    }
    const signed = await db.storage.from('list-attachments').createSignedUrl(objectPath, 3600);
    if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error('Image signing failed.');
    attachments.push({ id: `shared-${sha256.slice(0, 20)}`,
      contentKey: image.contentKey || `sha256:${sha256}`, name: file.name, type: file.type || 'image/webp',
      size: file.bytes.length, path: objectPath, url: signed.data.signedUrl, uploadedAt: new Date().toISOString() });
  }
  const current = await check(db.from('task_custom_field_values').select('value').eq('workspace_key', workspace)
    .eq('task_id', task.task_id).eq('field_id', fieldId).maybeSingle());
  if (current?.value != null && (!Array.isArray(current.value) || current.value.length)) throw new Error(`Concurrent image edit on ${task.task_id}; existing data preserved.`);
  await check(db.from('task_custom_field_values').upsert({ workspace_key: workspace, task_id: task.task_id, field_id: fieldId,
    value: attachments, updated_at: new Date().toISOString() }, { onConflict: 'task_id,field_id' }));
  journal.linkedTasks[task.task_id] = attachments.map(image => image.path);
  await saveJournal();
  linked++;
  if (linked % 25 === 0) console.log(`Verified photography on ${linked} additional products.`);
}
let workIndex = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (workIndex < work.length) await photograph(work[workIndex++]);
}));
products = await readCatalog();
if (missingFranchiseFlowers(products).length) throw new Error('Some Houston flower options are still missing in DMV.');
const before = JSON.parse(await fs.readFile(path.join(auditDir, 'before.json'), 'utf8'));
let preservedAttachments = 0;
for (const original of before.values) {
  // The field query can include subtasks. This migration only reads/writes
  // the parent product records captured in taskById.
  if (!taskById.has(original.task_id)) continue;
  const current = valuesByTask.get(original.task_id)?.get(original.field_id)?.value;
  const field = fields.find(field => field.field_id === original.field_id);
  if (field.field_name.toLowerCase() === 'product_image' && Array.isArray(original.value) && original.value.length) {
    if (JSON.stringify(current) !== JSON.stringify(original.value)) throw new Error('A pre-existing attachment changed during the migration.');
    preservedAttachments++;
  }
  if (JSON.stringify(current) === JSON.stringify(original.value)) continue;
  const ownNewPhoto = field.field_name.toLowerCase() === 'product_image' && journal.linkedTasks[original.task_id];
  const requestedActivation = field.field_name.toLowerCase() === 'active'
    && taskById.get(original.task_id)?.list_id === dmvList.list_id && current === true;
  if (!ownNewPhoto && !requestedActivation) throw new Error('An unrelated original catalog value changed during the migration.');
}
for (const [taskId, paths] of Object.entries(journal.linkedTasks)) {
  const fieldId = fieldFor(taskById.get(taskId).list_id, 'product_image').field_id;
  const saved = valuesByTask.get(taskId)?.get(fieldId)?.value;
  if (!Array.isArray(saved) || paths.some(objectPath => !saved.some(image => image.path === objectPath))) throw new Error('Saved image verification failed.');
}
const result = { workspace: workspaceRow.name, createdDmvProducts: Object.keys(journal.createdTasks).length,
  activatedDmvProducts: activeRows.length, photographedProducts: Object.keys(journal.linkedTasks).length,
  uploadedImages: Object.keys(journal.uploads).length, preservedAttachments, verifiedAt: new Date().toISOString() };
await fs.writeFile(path.join(auditDir, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
