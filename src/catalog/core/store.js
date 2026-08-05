/**
 * The smallest observable store that does the job.
 *
 * The catalog has three pieces of shared state — location, filters and the
 * quote list — and they are read by several independent views. This gives them
 * a common subscribe/notify shape without pulling in a state library.
 */

/**
 * @template T
 * @param {T} initialState
 */
export function createStore(initialState) {
  let state = initialState;
  /** @type {Set<(state: T) => void>} */
  const listeners = new Set();

  return {
    /** @returns {T} */
    getState() {
      return state;
    },

    /**
     * @param {Partial<T>|((state: T) => T)} update
     */
    setState(update) {
      const next = typeof update === 'function' ? update(state) : { ...state, ...update };
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener(state);
    },

    /**
     * @param {(state: T) => void} listener
     * @returns {() => void} unsubscribe
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
