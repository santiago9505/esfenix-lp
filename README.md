# Esfenix Landing Page

Landing page y catálogo de productos de Esfenix.

- `/` — landing page (`index.html`)
- `/catalog` y `/catalog/<categoria>/<slug>` — catálogo B2B (`catalog.html`)

El catálogo es una herramienta de solicitud de cotización, no una tienda.
No muestra precios en el sitio público. Fresa vuelve a resolver el precio
vigente en el backend al crear cada subtarea. Su documentación completa está en
[docs/catalog.md](docs/catalog.md).

## Desarrollo local

Instala dependencias:

```sh
npm install
```

Ejecuta el modo desarrollo:

```sh
npm run dev
```

Genera el build estático para Firebase Hosting:

```sh
npm run build
```

El build se genera en `dist/`.

Optimiza imágenes y video antes de un build si cambian los assets fuente:

```sh
npm run optimize:assets
```

Ejecuta las pruebas:

```sh
npm test
```

## Catálogo y Fresa

El navegador pinta primero `public/data/catalog-snapshot.json`, que la portada
precarga en segundo plano, para no bloquear los productos con una llamada
externa. Después consulta la integración pública de Fresa —limitada a las tres
listas de Esfenix y a campos no sensibles— y actualiza el catálogo sin
interrumpir la vista. No recibe una API key ni columnas de precio. Comprueba una
revisión ligera cada 15 segundos y solo vuelve a descargar el catálogo vivo
cuando algo cambió.

El snapshot se puede regenerar localmente con credenciales privadas en
`.env.local` (ese archivo no se versiona):

```env
FRESA_CATALOG_API_URL=https://fresaai.app/api/public/v1/tasks
FRESA_CATALOG_API_KEY=replace-with-a-rotated-fresa-catalog-key
FRESA_CATALOG_SOURCES=[{"listId":"replace-with-list-id","name":"Texas","activeFieldId":"replace-with-active-field-id"}]
```

```sh
npm run snapshot:catalog
npm run check:fresa-map
npm test
npm run build
```

Las credenciales `FRESA_*` nunca entran al bundle. El formulario de cotización
vive por completo en la landing y envía la solicitud mediante la API existente
de Fresa. Para prellenar clientes existentes, la landing envía únicamente el email a un Cloudflare
Worker pequeño; el Worker consulta en ese momento la lista `Active clients`
con una credencial privada y devuelve solamente el perfil de la coincidencia
exacta. No usa caché, KV ni base de datos. Un fallo de consulta nunca impide que
un email válido continúe como cliente nuevo. El borrador vive en
`sessionStorage`, y la selección de productos puede persistir como wishlist.

## Consulta segura de clientes activos

La configuración de despliegue está en `wrangler.jsonc`. Solo la API key se
guarda como secreto de Cloudflare:

```sh
npx wrangler secret put FRESA_CLIENTS_API_KEY
npx wrangler deploy
```

Después se construye la landing con la URL publicada:

```sh
VITE_FRESA_CLIENT_LOOKUP_URL=https://esfenix-client-lookup.<cuenta>.workers.dev npm run build
```

El Worker limita solicitudes, acepta los orígenes declarados en
`ALLOWED_ORIGINS`, exige POST JSON, valida el email y marca cada respuesta como
`no-store`. Los IDs de lista/campos son configuración no secreta; la API key
permanece en el Worker.

## Firebase Hosting estático (plan básico)

La configuración publica únicamente `dist/`. No se despliegan Functions,
Firestore, Authentication ni secretos; Firebase se usa solo para los archivos
estáticos:

```sh
firebase deploy --only hosting --project esfenix-landing-page
```

El build verifica automáticamente que ningún secreto de `.env.local` haya
entrado a `dist/` y que todos los scripts inline estén autorizados por la CSP.

## Delivery

Las ventanas de entrega son preferencias locales, no reservas. El visitante
elige una fecha y una de estas dos franjas: 8:00 AM–12:00 PM o 12:00–4:00 PM;
el equipo confirma disponibilidad,
mínimo de compra y hora final al revisar la solicitud. Así el flujo no necesita
Firestore ni ningún otro almacenamiento remoto.
