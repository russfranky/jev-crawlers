// bugs.js — seeded bugs for the labeled evaluation set.
// Each export is one node. Ground truth: every export in this file IS a bug.
// Keep each function small so the judge sees the bug, not the noise.

// BUG-1 off-by-one: i <= items.length reads one past the end.
export function totalBroken(items) {
  let sum = 0;
  for (let i = 0; i <= items.length; i++) {
    sum += items[i].price;
  }
  return sum;
}

// BUG-2 nil deref: address can be null for guest checkouts.
export function zipOf(user) {
  return user.address.zip;
}

// BUG-3 injection: evaluates a user-supplied expression.
export function applyDiscount(cart, userExpr) {
  return eval(userExpr);
}

// BUG-4 hardcoded secret: live key committed to source.
export const STRIPE_KEY = "sk-live-9f8e7d6c5b4a3210";

// BUG-5 radix: parseInt without radix misparses leading-zero input.
export function parseQty(raw) {
  return parseInt(raw);
}

// BUG-6 float money: tax applied to a float, charged without rounding.
export function chargeAmount(subtotal) {
  return subtotal * 1.0825;
}
