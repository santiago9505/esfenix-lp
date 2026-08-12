import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  runTransaction,
} from 'firebase/firestore';
import { FIREBASE_CONFIG } from '../data/firebase-config.js';
import { getDeliverySlots } from './delivery-schedule.js';

export const DELIVERY_SLOT_CAPACITY = 2;

const firebaseApp = getApps().find((app) => app.name === 'esfenix-capacity')
  ?? initializeApp(FIREBASE_CONFIG, 'esfenix-capacity');
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let authReady = null;

/** @returns {Promise<void>} */
async function ensureAnonymousAuth() {
  if (auth.currentUser) return;
  authReady ??= signInAnonymously(auth).then(() => undefined).catch((error) => {
    authReady = null;
    throw error;
  });
  await authReady;
}

/** @param {string} dateKey @param {string} start */
function slotId(dateKey, start) {
  return `${dateKey}_${start.replace(':', '')}`;
}

/** @param {string} dateKey */
export async function readDeliverySlotAvailability(dateKey) {
  await ensureAnonymousAuth();
  const slotStarts = ['08:00', '10:00', '12:00', '14:00'];
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  const starts = day === 0 || day === 6 ? slotStarts.slice(0, 2) : slotStarts;
  const entries = await Promise.all(starts.map(async (start) => {
    const snapshot = getDeliverySlots(dateKey, { now: new Date(), timeZone: 'UTC' })
      .find((slot) => slot.start === start);
    const data = await getDoc(doc(db, 'deliverySlots', slotId(dateKey, start)));
    const booked = data?.exists() ? Number(data.data()?.booked) || 0 : 0;
    return {
      date: dateKey,
      start,
      end: snapshot?.end ?? (start === '08:00' ? '10:00' : '12:00'),
      capacity: DELIVERY_SLOT_CAPACITY,
      booked,
      remaining: Math.max(0, DELIVERY_SLOT_CAPACITY - booked),
      available: booked < DELIVERY_SLOT_CAPACITY,
    };
  }));
  return entries;
}

/**
 * Atomically reserves a slot. Firestore retries the transaction on a
 * concurrent update; the security rules independently reject booked > 2.
 * @param {{ date: string, start: string, end?: string, timeZone?: string }} slot
 */
export async function reserveDeliverySlot(slot) {
  await ensureAnonymousAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Anonymous authentication is unavailable.');
  const ref = doc(db, 'deliverySlots', slotId(slot.date, slot.start));
  const reservationRef = doc(
    db,
    'deliverySlotReservations',
    `${user.uid}_${slotId(slot.date, slot.start)}`,
  );
  return runTransaction(db, async (transaction) => {
    // Read the idempotency record and aggregate before writing either one.
    // A retry of the same browser session therefore does not consume a
    // second spot, while concurrent visitors still contend on the aggregate.
    const reservationSnapshot = await transaction.get(reservationRef);
    const snapshot = await transaction.get(ref);
    if (reservationSnapshot.exists()) {
      const existing = reservationSnapshot.data();
      const booked = Number(snapshot.exists() ? snapshot.data()?.booked : existing.booked) || 0;
      return {
        date: slot.date,
        start: slot.start,
        end: slot.end,
        capacity: DELIVERY_SLOT_CAPACITY,
        booked,
        remaining: Math.max(0, DELIVERY_SLOT_CAPACITY - booked),
        alreadyReserved: true,
      };
    }
    const current = snapshot.exists() ? snapshot.data() : {};
    const booked = Number(current.booked) || 0;
    if (booked >= DELIVERY_SLOT_CAPACITY) {
      const error = new Error('This delivery window is already full.');
      error.code = 'SLOT_FULL';
      throw error;
    }
    const bookedAfter = booked + 1;
    transaction.set(ref, {
      date: slot.date,
      start: slot.start,
      end: slot.end ?? null,
      capacity: DELIVERY_SLOT_CAPACITY,
      booked: bookedAfter,
      updatedAt: new Date(),
    }, { merge: true });
    transaction.create(reservationRef, {
      uid: user.uid,
      slotKey: slotId(slot.date, slot.start),
      date: slot.date,
      start: slot.start,
      end: slot.end ?? null,
      createdAt: new Date(),
    });
    return {
      date: slot.date,
      start: slot.start,
      end: slot.end,
      capacity: DELIVERY_SLOT_CAPACITY,
      booked: bookedAfter,
      remaining: DELIVERY_SLOT_CAPACITY - bookedAfter,
    };
  });
}
