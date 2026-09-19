# todo-app fixture

A tiny cart and checkout used to test the crawlers end to end.

It contains one seeded bug: `total()` in `cart.js` loops with
`i <= cart.items.length`, reads one past the end, and returns `NaN`.

To test the diff seed and co-change expansion, make it a git repo with
some history:

```sh
cd examples/todo-app
git init && git add -A && git commit -m "initial cart"
# make a change, commit again, repeat; then run the crawler with --seed diff
```

Live test (needs `AI_GATEWAY_API_KEY`):

```sh
./bin/crawl.mjs --repo examples/todo-app --budget 10 --out /tmp/report.md
```
