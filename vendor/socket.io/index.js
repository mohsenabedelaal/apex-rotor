export class Server {
  constructor() {
    this.handlers = new Map();
  }
  on(event, handler) {
    this.handlers.set(event, handler);
    return this;
  }
  to() {
    return { emit() {} };
  }
  emit() {}
}
