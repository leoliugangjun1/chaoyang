export class GenerationTaskQueue {
  constructor({ concurrency = 2 } = {}) { this.concurrency = Math.max(1, Number(concurrency) || 1); this.pending = []; this.active = 0; }
  add(task) { return new Promise((resolve, reject) => { this.pending.push({ task, resolve, reject }); this.drain(); }); }
  drain() { while (this.active < this.concurrency && this.pending.length) { const item = this.pending.shift(); this.active += 1; Promise.resolve().then(() => item.task()).then(item.resolve, item.reject).finally(() => { this.active -= 1; this.drain(); }); } }
  get size() { return this.pending.length + this.active; }
}
