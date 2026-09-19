// benign.js — clean counterparts for the labeled evaluation set.
// Ground truth: every export in this file is NOT a bug.

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

export function newCart() {
  return { items: [] };
}

// Guarded accessor: the safe version of zipOf.
export function zipOfSafe(user) {
  return user?.address?.zip ?? "unknown";
}

// Validated add: the safe version of the cart helpers.
export function addItemSafe(cart, item) {
  if (!item || typeof item.price !== "number" || item.price < 0) {
    throw new Error("bad item");
  }
  cart.items.push(item);
  return cart;
}

// Correct bound: the fixed version of totalBroken.
export function totalFixed(items) {
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    sum += items[i].price;
  }
  return sum;
}

export const VERSION = 2;
