// pdfjs 在模块顶层 new DOMMatrix()；文本解析不需要渲染，用轻量 polyfill
globalThis.DOMMatrix = globalThis.DOMMatrix || class DOMMatrix {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
};
globalThis.Path2D = globalThis.Path2D || class Path2D {};
