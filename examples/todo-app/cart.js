// cart.js — a tiny shopping cart (fixture for crawler E2E tests).
// Seeded bug: total() uses the wrong loop bound (off-by-one on the last item).

export function addItem(cart, item) {
  cart.items.push(item);
  return cart;
}

// BUG: i <= cart.items.length reads one past the end; the last add is undefined.
export function total(cart) {
  let sum = 0;
  for (let i = 0; i <= cart.items.length; i++) {
    sum += cart.items[i].price;
  }
  return sum;
}

export function newCart() {
  return { items: [] };
}

// co-change note
export const VERSION = 2;

// uncommitted change for diff seed
export function clear(cart) { cart.items = []; }
