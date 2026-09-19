// checkout.js — uses cart.js (fixture for crawler E2E tests).

import { newCart, addItem, total } from './cart.js';

export function checkout(items) {
  const cart = newCart();
  for (const item of items) addItem(cart, item);
  const amount = total(cart); // TODO: round to cents before charging
  return { amount, itemCount: cart.items.length };
}
