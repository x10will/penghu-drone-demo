// node_modules/gridstack/dist/utils.js
var Utils = class _Utils {
  /**
   * Convert a potential selector into an actual list of HTML elements.
   * Supports CSS selectors, element references, and special ID handling.
   *
   * @param els selector string, HTMLElement, or array of elements
   * @param root optional root element to search within (defaults to document, useful for shadow DOM)
   * @returns array of HTML elements matching the selector
   *
   * @example
   * const elements = Utils.getElements('.grid-item');
   * const byId = Utils.getElements('#myWidget');
   * const fromShadow = Utils.getElements('.item', shadowRoot);
   */
  static getElements(els, root = document) {
    if (typeof els === "string") {
      const doc = "getElementById" in root ? root : void 0;
      if (doc && !isNaN(+els[0])) {
        const el2 = doc.getElementById(els);
        return el2 ? [el2] : [];
      }
      let list = root.querySelectorAll(els);
      if (!list.length && els[0] !== "." && els[0] !== "#") {
        list = root.querySelectorAll("." + els);
        if (!list.length)
          list = root.querySelectorAll("#" + els);
        if (!list.length) {
          const el2 = root.querySelector(`[gs-id="${els}"]`);
          return el2 ? [el2] : [];
        }
      }
      return Array.from(list);
    }
    return [els];
  }
  /**
   * Convert a potential selector into a single HTML element.
   * Similar to getElements() but returns only the first match.
   *
   * @param els selector string or HTMLElement
   * @param root optional root element to search within (defaults to document)
   * @returns the first HTML element matching the selector, or null if not found
   *
   * @example
   * const element = Utils.getElement('#myWidget');
   * const first = Utils.getElement('.grid-item');
   */
  static getElement(els, root = document) {
    if (typeof els === "string") {
      const doc = "getElementById" in root ? root : void 0;
      if (!els.length)
        return null;
      if (doc && els[0] === "#") {
        return doc.getElementById(els.substring(1));
      }
      if (els[0] === "#" || els[0] === "." || els[0] === "[") {
        return root.querySelector(els);
      }
      if (doc && !isNaN(+els[0])) {
        return doc.getElementById(els);
      }
      let el2 = root.querySelector(els);
      if (doc && !el2) {
        el2 = doc.getElementById(els);
      }
      if (!el2) {
        el2 = root.querySelector("." + els);
      }
      return el2;
    }
    return els;
  }
  /**
   * Check if a widget should be lazy loaded based on node or grid settings.
   *
   * @param n the grid node to check
   * @returns true if the item should be lazy loaded
   *
   * @example
   * if (Utils.lazyLoad(node)) {
   *   // Set up intersection observer for lazy loading
   * }
   */
  static lazyLoad(n) {
    return !!(n.lazyLoad || n.grid?.opts?.lazyLoad && n.lazyLoad !== false);
  }
  /**
   * Create a div element with the specified CSS classes.
   *
   * @param classes array of CSS class names to add
   * @param parent optional parent element to append the div to
   * @returns the created div element
   *
   * @example
   * const div = Utils.createDiv(['grid-item', 'draggable']);
   * const nested = Utils.createDiv(['content'], parentDiv);
   */
  static createDiv(classes, parent) {
    const el2 = document.createElement("div");
    classes.forEach((c) => {
      if (c)
        el2.classList.add(c);
    });
    parent?.appendChild(el2);
    return el2;
  }
  /**
   * Check if a widget should resize to fit its content.
   *
   * @param n the grid node to check (can be undefined)
   * @param strict if true, only returns true for explicit sizeToContent:true (not numbers)
   * @returns true if the widget should resize to content
   *
   * @example
   * if (Utils.shouldSizeToContent(node)) {
   *   // Trigger content-based resizing
   * }
   */
  static shouldSizeToContent(n, strict = false) {
    return !!(n?.grid && (strict ? n.sizeToContent === true || n.grid.opts.sizeToContent === true && n.sizeToContent === void 0 : !!n.sizeToContent || n.grid.opts.sizeToContent && n.sizeToContent !== false));
  }
  /**
   * Check if two grid positions overlap/intersect.
   *
   * @param a first position with x, y, w, h properties
   * @param b second position with x, y, w, h properties
   * @returns true if the positions overlap
   *
   * @example
   * const overlaps = Utils.isIntercepted(
   *   {x: 0, y: 0, w: 2, h: 1},
   *   {x: 1, y: 0, w: 2, h: 1}
   * ); // true - they overlap
   */
  static isIntercepted(a, b) {
    return !(a.y >= b.y + b.h || a.y + a.h <= b.y || a.x + a.w <= b.x || a.x >= b.x + b.w);
  }
  /**
   * Check if two grid positions are touching (edges or corners).
   *
   * @param a first position
   * @param b second position
   * @returns true if the positions are touching
   *
   * @example
   * const touching = Utils.isTouching(
   *   {x: 0, y: 0, w: 2, h: 1},
   *   {x: 2, y: 0, w: 1, h: 1}
   * ); // true - they share an edge
   */
  static isTouching(a, b) {
    return _Utils.isIntercepted(a, { x: b.x - 0.5, y: b.y - 0.5, w: b.w + 1, h: b.h + 1 });
  }
  /**
   * Calculate the overlapping area between two grid positions.
   *
   * @param a first position
   * @param b second position
   * @returns the area of overlap (0 if no overlap)
   *
   * @example
   * const overlap = Utils.areaIntercept(
   *   {x: 0, y: 0, w: 3, h: 2},
   *   {x: 1, y: 0, w: 3, h: 2}
   * ); // returns 4 (2x2 overlap)
   */
  static areaIntercept(a, b) {
    const x0 = a.x > b.x ? a.x : b.x;
    const x1 = a.x + a.w < b.x + b.w ? a.x + a.w : b.x + b.w;
    if (x1 <= x0)
      return 0;
    const y0 = a.y > b.y ? a.y : b.y;
    const y1 = a.y + a.h < b.y + b.h ? a.y + a.h : b.y + b.h;
    if (y1 <= y0)
      return 0;
    return (x1 - x0) * (y1 - y0);
  }
  /**
   * Calculate the total area of a grid position.
   *
   * @param a position with width and height
   * @returns the total area (width * height)
   *
   * @example
   * const area = Utils.area({x: 0, y: 0, w: 3, h: 2}); // returns 6
   */
  static area(a) {
    return a.w * a.h;
  }
  /**
   * Sort an array of grid nodes by position (y first, then x).
   *
   * @param nodes array of nodes to sort
   * @param dir sort direction: 1 for ascending (top-left first), -1 for descending
   * @returns the sorted array (modifies original)
   *
   * @example
   * const sorted = Utils.sort(nodes); // Sort top-left to bottom-right
   * const reverse = Utils.sort(nodes, -1); // Sort bottom-right to top-left
   */
  static sort(nodes, dir = 1) {
    const und = Number.MAX_SAFE_INTEGER;
    return nodes.sort((a, b) => {
      const diffY = dir * ((a.y ?? und) - (b.y ?? und));
      if (diffY === 0)
        return dir * ((a.x ?? und) - (b.x ?? und));
      return diffY;
    });
  }
  /**
   * Find a grid node by its ID.
   *
   * @param nodes array of nodes to search
   * @param id the ID to search for
   * @returns the node with matching ID, or undefined if not found
   *
   * @example
   * const node = Utils.find(nodes, 'widget-1');
   * if (node) console.log('Found node at:', node.x, node.y);
   */
  static find(nodes, id) {
    return id ? nodes.find((n) => n.id === id) : void 0;
  }
  /**
   * Find a node by ID in a grid, optionally searching nested sub-grids.
   *
   * @param g the grid to search
   * @param id the ID to search for
   * @param recursive if true (default), also search nested sub-grids
   * @returns the node with matching ID, or undefined if not found
   *
   * @example
   * const node = Utils.findInGrid(grid, 'widget-1');          // recursive by default
   * const top  = Utils.findInGrid(grid, 'widget-1', false);   // top-level only
   */
  static findInGrid(g, id, recursive) {
    const hit = g.engine.nodes.find((n) => String(n.id) === id);
    if (hit || !recursive)
      return hit;
    for (const n of g.engine.nodes) {
      if (n.subGrid) {
        const nested = _Utils.findInGrid(n.subGrid, id);
        if (nested)
          return nested;
      }
    }
    return void 0;
  }
  /**
   * Convert various value types to boolean.
   * Handles strings like 'false', 'no', '0' as false.
   *
   * @param v value to convert
   * @returns boolean representation
   *
   * @example
   * Utils.toBool('true');  // true
   * Utils.toBool('false'); // false
   * Utils.toBool('no');    // false
   * Utils.toBool('1');     // true
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static toBool(v) {
    if (typeof v === "boolean") {
      return v;
    }
    if (typeof v === "string") {
      v = v.toLowerCase();
      return !(v === "" || v === "no" || v === "false" || v === "0");
    }
    return Boolean(v);
  }
  /**
   * Convert a string value to a number, handling null and empty strings.
   *
   * @param value string or null value to convert
   * @returns number value, or undefined for null/empty strings
   *
   * @example
   * Utils.toNumber('42');  // 42
   * Utils.toNumber('');    // undefined
   * Utils.toNumber(null);  // undefined
   */
  static toNumber(value) {
    return value === null || value.length === 0 ? void 0 : Number(value);
  }
  /**
   * Parse a height value with units into numeric value and unit string.
   * Supports px, em, rem, vh, vw, %, cm, mm units.
   *
   * @param val height value as number or string with units
   * @returns object with h (height) and unit properties
   *
   * @example
   * Utils.parseHeight('100px');  // {h: 100, unit: 'px'}
   * Utils.parseHeight('2rem');   // {h: 2, unit: 'rem'}
   * Utils.parseHeight(50);       // {h: 50, unit: 'px'}
   */
  static parseHeight(val) {
    let h;
    let unit = "px";
    if (typeof val === "string") {
      if (val === "auto" || val === "")
        h = 0;
      else {
        const match = val.match(/^(-[0-9]+\.[0-9]+|[0-9]*\.[0-9]+|-[0-9]+|[0-9]+)(px|em|rem|vh|vw|%|cm|mm)?$/);
        if (!match) {
          throw new Error(`Invalid height val = ${val}`);
        }
        unit = match[2] || "px";
        h = parseFloat(match[1]);
      }
    } else {
      h = val;
    }
    return { h, unit };
  }
  /**
   * Copy unset fields from source objects to target object (shallow merge with defaults).
   * Similar to Object.assign but only sets undefined/null fields.
   *
   * @param target the object to copy defaults into
   * @param sources one or more source objects to copy defaults from
   * @returns the modified target object
   *
   * @example
   * const config = { width: 100 };
   * Utils.defaults(config, { width: 200, height: 50 });
   * // config is now { width: 100, height: 50 }
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static defaults(target, ...sources) {
    sources.forEach((source) => {
      for (const key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key))
          return;
        if (target[key] === null || target[key] === void 0) {
          target[key] = source[key];
        } else if (typeof source[key] === "object" && typeof target[key] === "object") {
          _Utils.defaults(target[key], source[key]);
        }
      }
    });
    return target;
  }
  /**
   * Compare two objects for equality (shallow comparison).
   * Checks if objects have the same fields and values at one level deep.
   *
   * @param a first object to compare
   * @param b second object to compare
   * @returns true if objects have the same values
   *
   * @example
   * Utils.same({x: 1, y: 2}, {x: 1, y: 2}); // true
   * Utils.same({x: 1}, {x: 1, y: 2}); // false
   */
  static same(a, b) {
    if (typeof a !== "object")
      return a == b;
    if (typeof a !== typeof b)
      return false;
    const ao = a;
    const bo = b;
    if (Object.keys(ao).length !== Object.keys(bo).length)
      return false;
    for (const key in ao) {
      if (ao[key] !== bo[key])
        return false;
    }
    return true;
  }
  /**
   * Copy position and size properties from one widget to another.
   * Copies x, y, w, h and optionally min/max constraints.
   *
   * @param a target widget to copy to
   * @param b source widget to copy from
   * @param doMinMax if true, also copy min/max width/height constraints
   * @returns the target widget (a)
   *
   * @example
   * Utils.copyPos(widget1, widget2); // Copy position/size
   * Utils.copyPos(widget1, widget2, true); // Also copy constraints
   */
  static copyPos(a, b, doMinMax = false) {
    if (b.x !== void 0)
      a.x = b.x;
    if (b.y !== void 0)
      a.y = b.y;
    if (b.w !== void 0)
      a.w = b.w;
    if (b.h !== void 0)
      a.h = b.h;
    if (doMinMax) {
      if (b.minW)
        a.minW = b.minW;
      if (b.minH)
        a.minH = b.minH;
      if (b.maxW)
        a.maxW = b.maxW;
      if (b.maxH)
        a.maxH = b.maxH;
    }
    return a;
  }
  /** true if a and b has same size & position */
  static samePos(a, b) {
    return a && b && a.x === b.x && a.y === b.y && (a.w || 1) === (b.w || 1) && (a.h || 1) === (b.h || 1);
  }
  /** given a node, makes sure it's min/max are valid */
  static sanitizeMinMax(node) {
    if (!node.minW) {
      delete node.minW;
    }
    if (!node.minH) {
      delete node.minH;
    }
    if (!node.maxW) {
      delete node.maxW;
    }
    if (!node.maxH) {
      delete node.maxH;
    }
  }
  /** removes field from the first object if same as the second objects (like diffing) and internal '_' for saving */
  static removeInternalAndSame(a, b) {
    if (typeof a !== "object" || typeof b !== "object")
      return;
    if (!a || !b)
      return;
    if (Array.isArray(a) || Array.isArray(b))
      return;
    const ao = a;
    const bo = b;
    for (const key in ao) {
      const aVal = ao[key];
      const bVal = bo[key];
      if (key[0] === "_" || aVal === bVal) {
        delete ao[key];
      } else if (aVal && typeof aVal === "object" && bVal !== void 0) {
        _Utils.removeInternalAndSame(aVal, bVal);
        if (!Object.keys(aVal).length) {
          delete ao[key];
        }
      }
    }
  }
  /** removes internal fields '_' and default values for saving */
  static removeInternalForSave(n, removeEl = true) {
    const nd = n;
    for (const key in nd) {
      if (key[0] === "_" || nd[key] === null || nd[key] === void 0)
        delete nd[key];
    }
    delete n.grid;
    if (removeEl)
      delete n.el;
    if (!n.autoPosition)
      delete n.autoPosition;
    if (!n.noResize)
      delete n.noResize;
    if (!n.noMove)
      delete n.noMove;
    if (!n.locked)
      delete n.locked;
    if (n.w === 1 || n.w === n.minW)
      delete n.w;
    if (n.h === 1 || n.h === n.minH)
      delete n.h;
  }
  /** delay calling the given function for given delay, preventing new calls from happening while waiting */
  static throttle(func, delay) {
    let isWaiting = false;
    return (...args) => {
      if (!isWaiting) {
        isWaiting = true;
        setTimeout(() => {
          func(...args);
          isWaiting = false;
        }, delay);
      }
    };
  }
  static removePositioningStyles(el2) {
    const style = el2.style;
    if (style.position) {
      style.removeProperty("position");
    }
    if (style.left) {
      style.removeProperty("left");
    }
    if (style.top) {
      style.removeProperty("top");
    }
    if (style.width) {
      style.removeProperty("width");
    }
    if (style.height) {
      style.removeProperty("height");
    }
  }
  /** @internal returns the passed element if vertically scrollable, else the closest parent that will, up to the entire document scrolling element */
  static getScrollElement(el2) {
    if (!el2)
      return document.scrollingElement || document.documentElement;
    const overflowY = getComputedStyle(el2).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && el2.scrollHeight > el2.clientHeight) {
      return el2;
    } else {
      return _Utils.getScrollElement(el2.parentElement ?? void 0);
    }
  }
  /**
   * @internal Function used to scroll the page.
   *
   * @param event `MouseEvent` that triggers the resize
   * @param el `HTMLElement` that's being resized
   * @param distance Distance from the V edges to start scrolling
   */
  static updateScrollResize(event2, el2, distance) {
    const scrollEl = _Utils.getScrollElement(el2);
    const height = scrollEl.clientHeight;
    const offsetTop = scrollEl === _Utils.getScrollElement() ? 0 : scrollEl.getBoundingClientRect().top;
    const pointerPosY = event2.clientY - offsetTop;
    const top = pointerPosY < distance;
    const bottom = pointerPosY > height - distance;
    if (top) {
      scrollEl.scrollBy({ behavior: "smooth", top: pointerPosY - distance });
    } else if (bottom) {
      scrollEl.scrollBy({ behavior: "smooth", top: distance - (height - pointerPosY) });
    }
  }
  /**
   * disable/re-enable pointer events on all iframes on the page while dragging/resizing, otherwise
   * fast mouse moves over an iframe get swallowed by its own document instead of reaching ours,
   * which stalls the drag/resize. See https://github.com/gridstack/gridstack.js/issues/934
   */
  static pauseIframePointerEvents(pause) {
    document.querySelectorAll("iframe").forEach((iframe) => {
      iframe.style.pointerEvents = pause ? "none" : "";
    });
  }
  /** single level clone, returning a new object with same top fields. This will share sub objects and arrays */
  static clone(obj) {
    if (obj === null || obj === void 0 || typeof obj !== "object") {
      return obj;
    }
    if (obj instanceof Array) {
      return [...obj];
    }
    return { ...obj };
  }
  /**
   * Recursive clone version that returns a full copy, checking for nested objects and arrays ONLY.
   * Note: this will use as-is any key starting with double __ (and not copy inside) some lib have circular dependencies.
   */
  static cloneDeep(obj) {
    const skipFields = ["parentGrid", "el", "grid", "subGrid", "engine"];
    const ret = _Utils.clone(obj);
    for (const key in ret) {
      if (Object.prototype.hasOwnProperty.call(ret, key) && typeof ret[key] === "object" && key.substring(0, 2) !== "__" && !skipFields.find((k) => k === key)) {
        ret[key] = _Utils.cloneDeep(obj[key]);
      }
    }
    return ret;
  }
  /** deep clone the given HTML node, removing the unique id field */
  static cloneNode(el2) {
    const node = el2.cloneNode(true);
    node.removeAttribute("id");
    return node;
  }
  static appendTo(el2, parent) {
    let parentNode;
    if (typeof parent === "string") {
      parentNode = _Utils.getElement(parent);
    } else {
      parentNode = parent;
    }
    if (parentNode) {
      parentNode.appendChild(el2);
    }
  }
  static addElStyles(el2, styles) {
    if (styles instanceof Object) {
      const elStyle = el2.style;
      for (const s in styles) {
        if (Object.prototype.hasOwnProperty.call(styles, s)) {
          if (Array.isArray(styles[s])) {
            styles[s].forEach((val) => {
              elStyle[s] = val;
            });
          } else {
            elStyle[s] = styles[s];
          }
        }
      }
    }
  }
  static initEvent(e, info) {
    const evt = { type: info.type };
    const obj = {
      button: 0,
      which: 0,
      buttons: 1,
      bubbles: true,
      cancelable: true,
      target: info.target ? info.target : e.target
    };
    const src = e;
    ["altKey", "ctrlKey", "metaKey", "shiftKey"].forEach((p) => evt[p] = src[p]);
    ["pageX", "pageY", "clientX", "clientY", "screenX", "screenY"].forEach((p) => evt[p] = src[p]);
    return { ...evt, ...obj };
  }
  /** copies the MouseEvent (or convert Touch) properties and sends it as another event to the given target */
  static simulateMouseEvent(e, simulatedType, target) {
    const me = e;
    const simulatedEvent = new MouseEvent(simulatedType, {
      bubbles: true,
      composed: true,
      cancelable: true,
      view: window,
      detail: 1,
      screenX: e.screenX,
      screenY: e.screenY,
      clientX: e.clientX,
      clientY: e.clientY,
      ctrlKey: me.ctrlKey ?? false,
      altKey: me.altKey ?? false,
      shiftKey: me.shiftKey ?? false,
      metaKey: me.metaKey ?? false,
      button: 0,
      relatedTarget: e.target
    });
    (target || e.target).dispatchEvent(simulatedEvent);
  }
  /**
   * defines an element that is used to get the offset and scale from grid transforms
   * returns the scale and offsets from said element
  */
  static getValuesFromTransformedElement(parent) {
    const transformReference = document.createElement("div");
    _Utils.addElStyles(transformReference, {
      opacity: "0",
      position: "fixed",
      top: "0px",
      left: "0px",
      width: "1px",
      height: "1px",
      zIndex: "-999999"
    });
    parent.appendChild(transformReference);
    const transformValues = transformReference.getBoundingClientRect();
    parent.removeChild(transformReference);
    transformReference.remove();
    return {
      xScale: 1 / transformValues.width,
      yScale: 1 / transformValues.height,
      xOffset: transformValues.left,
      yOffset: transformValues.top
    };
  }
  /** swap the given object 2 field values */
  static swap(o, a, b) {
    if (!o)
      return;
    const obj = o;
    const tmp = obj[a];
    obj[a] = obj[b];
    obj[b] = tmp;
  }
  /** true if the item can be rotated (checking for prop, not space available) */
  static canBeRotated(n) {
    return !(!n || n.w === n.h || n.locked || n.noResize || n.grid?.opts.disableResize || n.minW && n.minW === n.maxW || n.minH && n.minH === n.maxH);
  }
};

// node_modules/gridstack/dist/gridstack-engine.js
var GridStackEngine = class _GridStackEngine {
  constructor(opts = {}) {
    this.addedNodes = [];
    this.removedNodes = [];
    this.defaultColumn = 12;
    this.column = opts.column || this.defaultColumn;
    if (this.column > this.defaultColumn)
      this.defaultColumn = this.column;
    this.maxRow = opts.maxRow ?? 0;
    this._float = opts.float ?? false;
    this.nodes = opts.nodes || [];
    this.onChange = opts.onChange ?? (() => {
    });
  }
  /**
   * Enable/disable batch mode for multiple operations to optimize performance.
   * When enabled, layout updates are deferred until batch mode is disabled.
   *
   * @param flag true to enable batch mode, false to disable and apply changes
   * @param doPack if true (default), pack/compact nodes when disabling batch mode
   * @returns the engine instance for chaining
   *
   * @example
   * // Start batch mode for multiple operations
   * engine.batchUpdate(true);
   * engine.addNode(node1);
   * engine.addNode(node2);
   * engine.batchUpdate(false); // Apply all changes at once
   */
  batchUpdate(flag = true, doPack = true) {
    if (!!this.batchMode === flag)
      return this;
    this.batchMode = flag;
    if (flag) {
      this._prevFloat = this._float;
      this._float = true;
      this.cleanNodes();
      if (!this.nodes.some((n) => n._updating))
        this.saveInitial();
    } else {
      this._float = this._prevFloat ?? false;
      delete this._prevFloat;
      if (doPack)
        this._packNodes();
      this._notify();
    }
    return this;
  }
  // use entire row for hitting area (will use bottom reverse sorted first) if we not actively moving DOWN and didn't already skip
  _useEntireRowArea(node, nn) {
    return (!this.float || this.batchMode && !this._prevFloat) && !this._hasLocked && (!node._moving || node._skipDown || nn.y <= node.y);
  }
  /** @internal fix collision on given 'node', going to given new location 'nn', with optional 'collide' node already found.
   * return true if we moved. */
  _fixCollisions(node, nn = node, collide, opt = {}) {
    this.sortNodes(-1);
    collide = collide || this.collide(node, nn);
    if (!collide)
      return false;
    if (node._moving && !node._isExternal && !opt.nested && !this.float) {
      if (this.swap(node, collide))
        return true;
    }
    let area = nn;
    if (!this._loading && this._useEntireRowArea(node, nn)) {
      area = { x: 0, w: this.column, y: nn.y, h: nn.h };
      collide = this.collide(node, area, opt.skip);
    }
    let didMove = false;
    const newOpt = { nested: true, pack: false };
    let counter = 0;
    while (collide = collide || this.collide(node, area, opt.skip)) {
      if (counter++ > this.nodes.length * 2) {
        throw new Error("Infinite collide check");
      }
      let moved;
      if (collide.locked || this._loading || node._moving && !node._skipDown && nn.y > node.y && !this.float && // can take space we had, or before where we're going
      (!this.collide(collide, { ...collide, y: node.y }, node) || !this.collide(collide, { ...collide, y: nn.y - collide.h }, node))) {
        node._skipDown = node._skipDown || nn.y > node.y;
        const newNN = { ...nn, y: collide.y + collide.h, ...newOpt };
        moved = this._loading && Utils.samePos(node, newNN) ? true : this.moveNode(node, newNN);
        if ((collide.locked || this._loading) && moved) {
          Utils.copyPos(nn, node);
        } else if (!collide.locked && moved && opt.pack) {
          this._packNodes();
          nn.y = collide.y + collide.h;
          Utils.copyPos(node, nn);
        }
        didMove = didMove || moved;
      } else {
        moved = this.moveNode(collide, { ...collide, y: nn.y + nn.h, skip: node, ...newOpt });
      }
      if (!moved)
        return didMove;
      collide = void 0;
    }
    return didMove;
  }
  /**
   * Return the first node that intercepts/collides with the given node or area.
   * Used for collision detection during drag and drop operations.
   *
   * @param skip the node to skip in collision detection (usually the node being moved)
   * @param area the area to check for collisions (defaults to skip node's area)
   * @param skip2 optional second node to skip in collision detection
   * @returns the first colliding node, or undefined if no collision
   *
   * @example
   * const colliding = engine.collide(draggedNode, {x: 2, y: 1, w: 2, h: 1});
   * if (colliding) {
   *   console.log('Would collide with:', colliding.id);
   * }
   */
  collide(skip, area = skip, skip2) {
    const skipId = skip._id;
    const skip2Id = skip2?._id;
    return this.nodes.find((n) => n._id !== skipId && n._id !== skip2Id && Utils.isIntercepted(n, area));
  }
  /**
   * Return all nodes that intercept/collide with the given node or area.
   * Similar to collide() but returns all colliding nodes instead of just the first.
   *
   * @param skip the node to skip in collision detection
   * @param area the area to check for collisions (defaults to skip node's area)
   * @param skip2 optional second node to skip in collision detection
   * @returns array of all colliding nodes
   *
   * @example
   * const allCollisions = engine.collideAll(draggedNode);
   * console.log('Colliding with', allCollisions.length, 'nodes');
   */
  collideAll(skip, area = skip, skip2) {
    const skipId = skip._id;
    const skip2Id = skip2?._id;
    return this.nodes.filter((n) => n._id !== skipId && n._id !== skip2Id && Utils.isIntercepted(n, area));
  }
  /** does a pixel coverage collision based on where we started, returning the node that has the most coverage that is >50% mid line */
  directionCollideCoverage(node, o, collides) {
    if (!o.rect || !node._rect)
      return;
    const r0 = node._rect;
    const r = { ...o.rect };
    if (r.y > r0.y) {
      r.h = r.h + r.y - r0.y;
      r.y = r0.y;
    } else {
      r.h = r.h + r0.y - r.y;
    }
    if (r.x > r0.x) {
      r.w = r.w + r.x - r0.x;
      r.x = r0.x;
    } else {
      r.w = r.w + r0.x - r.x;
    }
    let collide;
    let overMax = 0.5;
    for (const n of collides) {
      if (n.locked || !n._rect) {
        continue;
      }
      const r2 = n._rect;
      let yOver = Number.MAX_VALUE, xOver = Number.MAX_VALUE;
      if (r0.y < r2.y) {
        yOver = (r.y + r.h - r2.y) / r2.h;
      } else if (r0.y + r0.h > r2.y + r2.h) {
        yOver = (r2.y + r2.h - r.y) / r2.h;
      }
      if (r0.x < r2.x) {
        xOver = (r.x + r.w - r2.x) / r2.w;
      } else if (r0.x + r0.w > r2.x + r2.w) {
        xOver = (r2.x + r2.w - r.x) / r2.w;
      }
      const over = Math.min(xOver, yOver);
      if (over > overMax) {
        overMax = over;
        collide = n;
      }
    }
    o.collide = collide;
    return collide;
  }
  /**
   * Cache the pixel rectangles for all nodes used for collision detection during drag operations.
   * This optimization converts grid coordinates to pixel coordinates for faster collision detection.
   *
   * @param w width of a single grid cell in pixels
   * @param h height of a single grid cell in pixels
   * @param top top margin/padding in pixels
   * @param right right margin/padding in pixels
   * @param bottom bottom margin/padding in pixels
   * @param left left margin/padding in pixels
   * @returns the engine instance for chaining
   *
   * @internal This is typically called by GridStack during resize events
   */
  cacheRects(w, h, top, right, bottom, left) {
    this.nodes.forEach((n) => n._rect = {
      y: n.y * h + top,
      x: n.x * w + left,
      w: n.w * w - left - right,
      h: n.h * h - top - bottom
    });
    return this;
  }
  /**
   * Attempt to swap the positions of two nodes if they meet swapping criteria.
   * Nodes can swap if they are the same size or in the same column/row, not locked, and touching.
   *
   * @param a first node to swap
   * @param b second node to swap
   * @returns true if swap was successful, false if not possible, undefined if not applicable
   *
   * @example
   * const swapped = engine.swap(nodeA, nodeB);
   * if (swapped) {
   *   console.log('Nodes swapped successfully');
   * }
   */
  swap(a, b) {
    if (!b || b.locked || !a || a.locked)
      return false;
    function _doSwap() {
      const x = b.x, y = b.y;
      b.x = a.x;
      b.y = a.y;
      if (a.h != b.h) {
        a.x = x;
        a.y = b.y + b.h;
      } else if (a.w != b.w) {
        a.x = b.x + b.w;
        a.y = y;
      } else {
        a.x = x;
        a.y = y;
      }
      a._dirty = b._dirty = true;
      return true;
    }
    let touching;
    if (a.w === b.w && a.h === b.h && (a.x === b.x || a.y === b.y) && (touching = Utils.isTouching(a, b)))
      return _doSwap();
    if (touching === false)
      return;
    if (a.w === b.w && a.x === b.x && (touching || (touching = Utils.isTouching(a, b)))) {
      if (b.y < a.y) {
        const t = a;
        a = b;
        b = t;
      }
      return _doSwap();
    }
    if (touching === false)
      return;
    if (a.h === b.h && a.y === b.y && (touching || (touching = Utils.isTouching(a, b)))) {
      if (b.x < a.x) {
        const t = a;
        a = b;
        b = t;
      }
      return _doSwap();
    }
    return false;
  }
  /**
   * Check if the specified rectangular area is empty (no nodes occupy any part of it).
   *
   * @param x the x coordinate (column) of the area to check
   * @param y the y coordinate (row) of the area to check
   * @param w the width in columns of the area to check
   * @param h the height in rows of the area to check
   * @returns true if the area is completely empty, false if any node overlaps
   *
   * @example
   * if (engine.isAreaEmpty(2, 1, 3, 2)) {
   *   console.log('Area is available for placement');
   * }
   */
  isAreaEmpty(x, y, w, h) {
    const nn = { x: x || 0, y: y || 0, w: w || 1, h: h || 1 };
    return !this.collide(nn);
  }
  /**
   * Re-layout grid items to reclaim any empty space.
   * This optimizes the grid layout by moving items to fill gaps.
   *
   * @param layout layout algorithm to use:
   *   - 'compact' (default): find truly empty spaces, may reorder items
   *   - 'list': keep the sort order exactly the same, move items up sequentially
   * @param doSort if true (default), sort nodes by position before compacting
   * @returns the engine instance for chaining
   *
   * @example
   * // Compact to fill empty spaces
   * engine.compact();
   *
   * // Compact preserving item order
   * engine.compact('list');
   */
  compact(layout = "compact", doSort = true) {
    if (this.nodes.length === 0)
      return this;
    if (doSort)
      this.sortNodes();
    const wasBatch = this.batchMode;
    if (!wasBatch)
      this.batchUpdate();
    const wasColumnResize = this._inColumnResize;
    if (!wasColumnResize)
      this._inColumnResize = true;
    const copyNodes = this.nodes;
    this.nodes = [];
    copyNodes.forEach((n, index, list) => {
      let after;
      if (!n.locked) {
        n.autoPosition = true;
        if (layout === "list" && index)
          after = list[index - 1];
      }
      this.addNode(n, false, after);
    });
    if (!wasColumnResize)
      delete this._inColumnResize;
    if (!wasBatch)
      this.batchUpdate(false);
    return this;
  }
  /**
   * Enable/disable floating widgets (default: `false`).
   * When floating is enabled, widgets can move up to fill empty spaces.
   * See [example](http://gridstackjs.com/demo/float.html)
   *
   * @param val true to enable floating, false to disable
   *
   * @example
   * engine.float = true;  // Enable floating
   * engine.float = false; // Disable floating (default)
   */
  set float(val) {
    if (this._float === val)
      return;
    this._float = val || false;
    if (!val) {
      this._packNodes()._notify();
    }
  }
  /**
   * Get the current floating mode setting.
   *
   * @returns true if floating is enabled, false otherwise
   *
   * @example
   * const isFloating = engine.float;
   * console.log('Floating enabled:', isFloating);
   */
  get float() {
    return this._float || false;
  }
  /**
   * Sort the nodes array from first to last, or reverse.
   * This is called during collision/placement operations to enforce a specific order.
   *
   * @param dir sort direction: 1 for ascending (first to last), -1 for descending (last to first)
   * @returns the engine instance for chaining
   *
   * @example
   * engine.sortNodes();    // Sort ascending (default)
   * engine.sortNodes(-1);  // Sort descending
   */
  sortNodes(dir = 1) {
    this.nodes = Utils.sort(this.nodes, dir);
    return this;
  }
  /** @internal called to top gravity pack the items back OR revert back to original Y positions when floating */
  _packNodes() {
    if (this.batchMode) {
      return this;
    }
    this.sortNodes();
    if (this.float) {
      this.nodes.forEach((n) => {
        if (n._updating || n._orig === void 0 || n.y === n._orig.y)
          return;
        let newY = n.y;
        while (newY > n._orig.y) {
          --newY;
          const collide = this.collide(n, { x: n.x, y: newY, w: n.w, h: n.h });
          if (!collide) {
            n._dirty = true;
            n.y = newY;
          }
        }
      });
    } else {
      this.nodes.forEach((n, i) => {
        if (n.locked)
          return;
        while (n.y > 0) {
          const newY = i === 0 ? 0 : n.y - 1;
          const canBeMoved = i === 0 || !this.collide(n, { x: n.x, y: newY, w: n.w, h: n.h });
          if (!canBeMoved)
            break;
          n._dirty = n.y !== newY;
          n.y = newY;
        }
      });
    }
    return this;
  }
  /**
   * Prepare and validate a node's coordinates and values for the current grid.
   * This ensures the node has valid position, size, and properties before being added to the grid.
   *
   * @param node the node to prepare and validate
   * @param resizing if true, resize the node down if it's out of bounds; if false, move it to fit
   * @returns the prepared node with valid coordinates
   *
   * @example
   * const node = { w: 3, h: 2, content: 'Hello' };
   * const prepared = engine.prepareNode(node);
   * console.log('Node prepared at:', prepared.x, prepared.y);
   */
  prepareNode(node, resizing) {
    node._id = node._id ?? _GridStackEngine._idSeq++;
    const id = node.id;
    if (id) {
      let count = 1;
      while (this.nodes.find((n) => n.id === node.id && n !== node)) {
        node.id = id + "_" + count++;
      }
    }
    if (node.x === void 0 || node.y === void 0 || node.x === null || node.y === null) {
      node.autoPosition = true;
    }
    const defaults = { x: 0, y: 0, w: 1, h: 1 };
    Utils.defaults(node, defaults);
    if (!node.autoPosition) {
      delete node.autoPosition;
    }
    if (!node.noResize) {
      delete node.noResize;
    }
    if (!node.noMove) {
      delete node.noMove;
    }
    Utils.sanitizeMinMax(node);
    if (typeof node.x == "string") {
      node.x = Number(node.x);
    }
    if (typeof node.y == "string") {
      node.y = Number(node.y);
    }
    if (typeof node.w == "string") {
      node.w = Number(node.w);
    }
    if (typeof node.h == "string") {
      node.h = Number(node.h);
    }
    if (isNaN(node.x)) {
      node.x = defaults.x;
      node.autoPosition = true;
    }
    if (isNaN(node.y)) {
      node.y = defaults.y;
      node.autoPosition = true;
    }
    if (isNaN(node.w)) {
      node.w = defaults.w;
    }
    if (isNaN(node.h)) {
      node.h = defaults.h;
    }
    this.nodeBoundFix(node, resizing);
    return node;
  }
  /**
   * Part 2 of preparing a node to fit inside the grid - validates and fixes coordinates and dimensions.
   * This ensures the node fits within grid boundaries and respects min/max constraints.
   *
   * @param node the node to validate and fix
   * @param resizing if true, resize the node to fit; if false, move the node to fit
   * @returns the engine instance for chaining
   *
   * @example
   * // Fix a node that might be out of bounds
   * engine.nodeBoundFix(node, true); // Resize to fit
   * engine.nodeBoundFix(node, false); // Move to fit
   */
  nodeBoundFix(node, resizing) {
    const before = node._orig || Utils.copyPos({}, node);
    if (node.maxW) {
      node.w = Math.min(node.w || 1, node.maxW);
    }
    if (node.maxH) {
      node.h = Math.min(node.h || 1, node.maxH);
    }
    if (node.minW) {
      node.w = Math.max(node.w || 1, node.minW);
    }
    if (node.minH) {
      node.h = Math.max(node.h || 1, node.minH);
    }
    const saveOrig = (node.x || 0) + (node.w || 1) > this.column;
    if (saveOrig && this.column < this.defaultColumn && !this._inColumnResize && !this.skipCacheUpdate && node._id != null && this.findCacheLayout(node, this.defaultColumn) === -1) {
      const copy = { ...node };
      if (copy.autoPosition || copy.x === void 0) {
        delete copy.x;
        delete copy.y;
      } else
        copy.x = Math.min(this.defaultColumn - 1, copy.x);
      copy.w = Math.min(this.defaultColumn, copy.w || 1);
      this.cacheOneLayout(copy, this.defaultColumn);
    }
    if (node.w > this.column) {
      node.w = this.column;
    } else if (node.w < 1) {
      node.w = 1;
    }
    if (this.maxRow && node.h > this.maxRow) {
      node.h = this.maxRow;
    } else if (node.h < 1) {
      node.h = 1;
    }
    if (node.x < 0) {
      node.x = 0;
    }
    if (node.y < 0) {
      node.y = 0;
    }
    if (node.x + node.w > this.column) {
      if (resizing) {
        node.w = this.column - node.x;
      } else {
        node.x = this.column - node.w;
      }
    }
    if (this.maxRow && node.y + node.h > this.maxRow) {
      if (resizing) {
        node.h = this.maxRow - node.y;
      } else {
        node.y = this.maxRow - node.h;
      }
    }
    if (!Utils.samePos(node, before)) {
      node._dirty = true;
    }
    return this;
  }
  /**
   * Returns a list of nodes that have been modified from their original values.
   * This is used to track which nodes need DOM updates.
   *
   * @param verify if true, performs additional verification by comparing current vs original positions
   * @returns array of nodes that have been modified
   *
   * @example
   * const changed = engine.getDirtyNodes();
   * console.log('Modified nodes:', changed.length);
   *
   * // Get verified dirty nodes
   * const verified = engine.getDirtyNodes(true);
   */
  getDirtyNodes(verify) {
    if (verify) {
      return this.nodes.filter((n) => n._dirty && n._orig && !Utils.samePos(n, n._orig));
    }
    return this.nodes.filter((n) => n._dirty);
  }
  /** @internal call this to call onChange callback with dirty nodes so DOM can be updated */
  _notify(removedNodes) {
    if (this.batchMode || !this.onChange)
      return this;
    const dirtyNodes = (removedNodes || []).concat(this.getDirtyNodes());
    this.onChange(dirtyNodes);
    return this;
  }
  /**
   * Clean all dirty and last tried information from nodes.
   * This resets the dirty state tracking for all nodes.
   *
   * @returns the engine instance for chaining
   *
   * @internal
   */
  cleanNodes() {
    if (this.batchMode)
      return this;
    this.nodes.forEach((n) => {
      delete n._dirty;
      delete n._lastTried;
    });
    return this;
  }
  /**
   * Save the initial position/size of all nodes to track real dirty state.
   * This creates a snapshot of current positions that can be restored later.
   *
   * Note: Should be called right after change events and before move/resize operations.
   *
   * @returns the engine instance for chaining
   *
   * @internal
   */
  saveInitial() {
    this.nodes.forEach((n) => {
      n._orig = Utils.copyPos({}, n);
      delete n._dirty;
    });
    this._hasLocked = this.nodes.some((n) => n.locked);
    return this;
  }
  /**
   * Restore all nodes back to their initial values.
   * This is typically called when canceling an operation (e.g., Esc key during drag).
   *
   * @returns the engine instance for chaining
   *
   * @internal
   */
  restoreInitial() {
    this.nodes.forEach((n) => {
      if (!n._orig || Utils.samePos(n, n._orig))
        return;
      Utils.copyPos(n, n._orig);
      n._dirty = true;
    });
    this._notify();
    return this;
  }
  /**
   * Find the first available empty spot for the given node dimensions.
   * Updates the node's x,y attributes with the found position.
   *
   * @param node the node to find a position for (w,h must be set)
   * @param nodeList optional list of nodes to check against (defaults to engine nodes)
   * @param column optional column count (defaults to engine column count)
   * @param after optional node to start search after (maintains order)
   * @returns true if an empty position was found and node was updated
   *
   * @example
   * const node = { w: 2, h: 1 };
   * if (engine.findEmptyPosition(node)) {
   *   console.log('Found position at:', node.x, node.y);
   * }
   */
  findEmptyPosition(node, nodeList = this.nodes, column = this.column, after) {
    const start = after ? after.y * column + (after.x + after.w) : 0;
    let found = false;
    for (let i = start; !found; ++i) {
      const x = i % column;
      const y = Math.floor(i / column);
      if (x + node.w > column) {
        continue;
      }
      const box = { x, y, w: node.w, h: node.h };
      if (!nodeList.find((n) => Utils.isIntercepted(box, n))) {
        if (node.x !== x || node.y !== y)
          node._dirty = true;
        node.x = x;
        node.y = y;
        delete node.autoPosition;
        found = true;
      }
    }
    return found;
  }
  /**
   * Add the given node to the grid, handling collision detection and re-packing.
   * This is the main method for adding new widgets to the engine.
   *
   * @param node the node to add to the grid
   * @param triggerAddEvent if true, adds node to addedNodes list for event triggering
   * @param after optional node to place this node after (for ordering)
   * @returns the added node (or existing node if duplicate)
   *
   * @example
   * const node = { x: 0, y: 0, w: 2, h: 1, content: 'Hello' };
   * const added = engine.addNode(node, true);
   */
  addNode(node, triggerAddEvent = false, after) {
    const dup = this.nodes.find((n) => n._id === node._id);
    if (dup)
      return dup;
    this._inColumnResize ? this.nodeBoundFix(node) : this.prepareNode(node);
    delete node._temporaryRemoved;
    delete node._removeDOM;
    let skipCollision = false;
    if (node.autoPosition && this.findEmptyPosition(node, this.nodes, this.column, after)) {
      delete node.autoPosition;
      skipCollision = true;
    }
    this.nodes.push(node);
    if (triggerAddEvent) {
      this.addedNodes.push(node);
    }
    if (!skipCollision)
      this._fixCollisions(node);
    if (!this.batchMode) {
      this._packNodes()._notify();
    }
    return node;
  }
  /**
   * Remove the given node from the grid.
   *
   * @param node the node to remove
   * @param removeDOM if true (default), marks node for DOM removal
   * @param triggerEvent if true, adds node to removedNodes list for event triggering
   * @returns the engine instance for chaining
   *
   * @example
   * engine.removeNode(node, true, true);
   */
  removeNode(node, removeDOM = true, triggerEvent = false) {
    if (!this.nodes.find((n) => n._id === node._id)) {
      return this;
    }
    if (triggerEvent) {
      this.removedNodes.push(node);
    }
    if (removeDOM)
      node._removeDOM = true;
    this.nodes = this.nodes.filter((n) => n._id !== node._id);
    if (!node._isAboutToRemove)
      this._packNodes();
    this._notify([node]);
    return this;
  }
  /**
   * Remove all nodes from the grid.
   *
   * @param removeDOM if true (default), marks all nodes for DOM removal
   * @param triggerEvent if true (default), triggers removal events
   * @returns the engine instance for chaining
   *
   * @example
   * engine.removeAll(); // Remove all nodes
   */
  removeAll(removeDOM = true, triggerEvent = true) {
    delete this._layouts;
    if (!this.nodes.length)
      return this;
    removeDOM && this.nodes.forEach((n) => n._removeDOM = true);
    const removedNodes = this.nodes;
    this.removedNodes = triggerEvent ? removedNodes : [];
    this.nodes = [];
    return this._notify(removedNodes);
  }
  /**
   * Check if a node can be moved to a new position, considering layout constraints.
   * This is a safer version of moveNode() that validates the move first.
   *
   * For complex cases (like maxRow constraints), it simulates the move in a clone first,
   * then applies the changes only if they meet all specifications.
   *
   * @param node the node to move
   * @param o move options including target position
   * @returns true if the node was successfully moved
   *
   * @example
   * const canMove = engine.moveNodeCheck(node, { x: 2, y: 1 });
   * if (canMove) {
   *   console.log('Node moved successfully');
   * }
   */
  moveNodeCheck(node, o) {
    if (!this.changedPosConstrain(node, o))
      return false;
    o.pack = true;
    if (!this.maxRow) {
      return this.moveNode(node, o);
    }
    let clonedNode;
    const clone = new _GridStackEngine({
      column: this.column,
      float: this.float,
      nodes: this.nodes.map((n) => {
        if (n._id === node._id) {
          clonedNode = { ...n };
          return clonedNode;
        }
        return { ...n };
      })
    });
    if (!clonedNode)
      return false;
    const canMove = clone.moveNode(clonedNode, o) && clone.getRow() <= Math.max(this.getRow(), this.maxRow);
    if (!canMove && !o.resizing && o.collide && !node._isExternal) {
      const collide = o.collide.el?.gridstackNode;
      if (collide && this.swap(node, collide)) {
        this._notify();
        return true;
      }
    }
    if (!canMove)
      return false;
    clone.nodes.filter((n) => n._dirty).forEach((c) => {
      const n = this.nodes.find((a) => a._id === c._id);
      if (!n)
        return;
      Utils.copyPos(n, c);
      n._dirty = true;
    });
    this._notify();
    return true;
  }
  /** return true if can fit in grid height constrain only (always true if no maxRow) */
  willItFit(node) {
    delete node._willFitPos;
    if (!this.maxRow)
      return true;
    const clone = new _GridStackEngine({
      column: this.column,
      float: this.float,
      nodes: this.nodes.map((n2) => {
        return { ...n2 };
      })
    });
    const n = { ...node };
    this.cleanupNode(n);
    delete n.el;
    delete n._id;
    delete n.content;
    delete n.grid;
    clone.addNode(n);
    if (clone.getRow() <= this.maxRow) {
      node._willFitPos = Utils.copyPos({}, n);
      return true;
    }
    return false;
  }
  /** true if x,y or w,h are different after clamping to min/max */
  changedPosConstrain(node, p) {
    p.w = p.w || node.w;
    p.h = p.h || node.h;
    if (node.x !== p.x || node.y !== p.y)
      return true;
    if (node.maxW) {
      p.w = Math.min(p.w, node.maxW);
    }
    if (node.maxH) {
      p.h = Math.min(p.h, node.maxH);
    }
    if (node.minW) {
      p.w = Math.max(p.w, node.minW);
    }
    if (node.minH) {
      p.h = Math.max(p.h, node.minH);
    }
    return node.w !== p.w || node.h !== p.h;
  }
  /** return true if the passed in node was actually moved (checks for no-op and locked) */
  moveNode(node, o) {
    if (!node || /*node.locked ||*/
    !o)
      return false;
    let wasUndefinedPack = false;
    if (o.pack === void 0 && !this.batchMode) {
      wasUndefinedPack = o.pack = true;
    }
    if (typeof o.x !== "number") {
      o.x = node.x;
    }
    if (typeof o.y !== "number") {
      o.y = node.y;
    }
    if (typeof o.w !== "number") {
      o.w = node.w;
    }
    if (typeof o.h !== "number") {
      o.h = node.h;
    }
    const resizing = node.w !== o.w || node.h !== o.h;
    const nn = Utils.copyPos({}, node, true);
    Utils.copyPos(nn, o);
    this.nodeBoundFix(nn, resizing);
    Utils.copyPos(o, nn);
    if (!o.forceCollide && Utils.samePos(node, o))
      return false;
    const prevPos = Utils.copyPos({}, node);
    const collides = this.collideAll(node, nn, o.skip);
    let needToMove = true;
    if (collides.length) {
      const activeDrag = node._moving && !o.nested;
      let collide = activeDrag ? this.directionCollideCoverage(node, o, collides) : collides[0];
      if (activeDrag && collide && node.grid?.opts?.subGridDynamic && !node.grid._isTemp) {
        const over = Utils.areaIntercept(o.rect, collide._rect);
        const a1 = Utils.area(o.rect);
        const a2 = Utils.area(collide._rect);
        const perc = over / (a1 < a2 ? a1 : a2);
        if (perc > 0.8) {
          collide.grid.makeSubGrid(collide.el, void 0, node);
          collide = void 0;
        }
      }
      if (collide) {
        needToMove = !this._fixCollisions(node, nn, collide, o);
      } else {
        needToMove = false;
        if (wasUndefinedPack)
          delete o.pack;
      }
    }
    if (needToMove && !Utils.samePos(node, nn)) {
      node._dirty = true;
      Utils.copyPos(node, nn);
    }
    if (o.pack) {
      this._packNodes()._notify();
    }
    return !Utils.samePos(node, prevPos);
  }
  getRow() {
    return this.nodes.reduce((row, n) => Math.max(row, n.y + n.h), 0);
  }
  beginUpdate(node) {
    if (!node._updating) {
      node._updating = true;
      delete node._skipDown;
      if (!this.batchMode)
        this.saveInitial();
    }
    return this;
  }
  endUpdate() {
    const n = this.nodes.find((n2) => n2._updating);
    if (n) {
      delete n._updating;
      delete n._skipDown;
    }
    return this;
  }
  /** saves a copy of the largest column layout (eg 12 even when rendering 1 column) so we don't loose orig layout, unless explicity column
   * count to use is given. returning a list of widgets for serialization
   * @param saveElement if true (default), the element will be saved to GridStackWidget.el field, else it will be removed.
   * @param saveCB callback for each node -> widget, so application can insert additional data to be saved into the widget data structure.
   * @param column if provided, the grid will be saved for the given column count (IFF we have matching internal saved layout, or current layout).
   * Note: nested grids will ALWAYS save the container w to match overall layouts (parent + child) to be consistent.
  */
  save(saveElement = true, saveCB, column) {
    const len = this._layouts?.length || 0;
    let layout;
    if (len) {
      if (column) {
        if (column !== this.column)
          layout = this._layouts[column];
      } else if (this.column !== len - 1) {
        layout = this._layouts[len - 1];
      }
    }
    const list = [];
    this.sortNodes();
    this.nodes.forEach((n) => {
      const wl = layout?.find((l) => l._id === n._id);
      const w = { ...n, ...wl || {} };
      Utils.removeInternalForSave(w, !saveElement);
      if (saveCB)
        saveCB(n, w);
      list.push(w);
    });
    return list;
  }
  /** @internal called whenever a node is added or moved - updates the cached layouts */
  layoutsNodesChange(nodes) {
    if (!this._layouts || this._inColumnResize)
      return this;
    this._layouts.forEach((layout, column) => {
      if (!layout || column === this.column)
        return;
      if (column < this.column) {
        this._layouts[column] = void 0;
      } else {
        const ratio = column / this.column;
        nodes.forEach((node) => {
          if (!node._orig)
            return;
          const n = layout.find((l) => l._id === node._id);
          if (!n)
            return;
          if (n.y >= 0 && node.y !== node._orig.y) {
            n.y = n.y + (node.y - node._orig.y);
            if (n.y < 0)
              n.y = 0;
          }
          if (node.x !== node._orig.x) {
            n.x = Math.round(node.x * ratio);
            if (n.x < 0)
              n.x = 0;
          }
          if (node.w !== node._orig.w) {
            n.w = Math.round(node.w * ratio);
            if (n.w < 1)
              n.w = 1;
          }
        });
      }
    });
    return this;
  }
  /**
   * @internal Called to scale the widget width & position up/down based on the column change.
   * Note we store previous layouts (especially original ones) to make it possible to go
   * from say 12 -> 1 -> 12 and get back to where we were.
   *
   * @param prevColumn previous number of columns
   * @param column  new column number
   * @param layout specify the type of re-layout that will happen (position, size, etc...).
   * Note: items will never be outside of the current column boundaries. default (moveScale). Ignored for 1 column
   */
  columnChanged(prevColumn, column, layout = "moveScale") {
    if (!this.nodes.length || !column || prevColumn === column)
      return this;
    const doCompact = layout === "compact" || layout === "list";
    if (doCompact) {
      this.sortNodes(1);
    }
    if (column < prevColumn)
      this.cacheLayout(this.nodes, prevColumn);
    this.batchUpdate();
    let newNodes = [];
    let nodes = doCompact ? this.nodes : Utils.sort(this.nodes, -1);
    if (column > prevColumn && this._layouts) {
      const cacheNodes = this._layouts[column] || [];
      const lastIndex = this._layouts.length - 1;
      if (!cacheNodes.length && prevColumn !== lastIndex && this._layouts[lastIndex]?.length) {
        prevColumn = lastIndex;
        this._layouts[lastIndex].forEach((cacheNode) => {
          const n = nodes.find((n2) => n2._id === cacheNode._id);
          if (n) {
            if (!doCompact && !cacheNode.autoPosition) {
              n.x = cacheNode.x ?? n.x;
              n.y = cacheNode.y ?? n.y;
            }
            n.w = cacheNode.w ?? n.w;
            if (cacheNode.x == void 0 || cacheNode.y === void 0)
              n.autoPosition = true;
          }
        });
      }
      cacheNodes.forEach((cacheNode) => {
        const j = nodes.findIndex((n) => n._id === cacheNode._id);
        if (j !== -1) {
          const n = nodes[j];
          if (doCompact) {
            n.w = cacheNode.w;
            return;
          }
          if (cacheNode.autoPosition || isNaN(cacheNode.x) || isNaN(cacheNode.y)) {
            this.findEmptyPosition(cacheNode, newNodes);
          }
          if (!cacheNode.autoPosition) {
            n.x = cacheNode.x ?? n.x;
            n.y = cacheNode.y ?? n.y;
            n.w = cacheNode.w ?? n.w;
            newNodes.push(n);
          }
          nodes.splice(j, 1);
        }
      });
    }
    if (doCompact) {
      this.compact(layout, false);
    } else {
      if (nodes.length) {
        if (typeof layout === "function") {
          layout(column, prevColumn, newNodes, nodes);
        } else {
          const ratio = doCompact || layout === "none" ? 1 : column / prevColumn;
          const move = layout === "move" || layout === "moveScale";
          const scale = layout === "scale" || layout === "moveScale";
          nodes.forEach((node) => {
            node.x = column === 1 ? 0 : move ? Math.round(node.x * ratio) : Math.min(node.x, column - 1);
            node.w = column === 1 || prevColumn === 1 ? 1 : scale ? Math.round(node.w * ratio) || 1 : Math.min(node.w, column);
            newNodes.push(node);
          });
          nodes = [];
        }
      }
      newNodes = Utils.sort(newNodes, -1);
      this._inColumnResize = true;
      this.nodes = [];
      newNodes.forEach((node) => {
        this.addNode(node, false);
        delete node._orig;
      });
    }
    this.nodes.forEach((n) => delete n._orig);
    this.batchUpdate(false, !doCompact);
    delete this._inColumnResize;
    return this;
  }
  /**
   * call to cache the given layout internally to the given location so we can restore back when column changes size
   * @param nodes list of nodes
   * @param column corresponding column index to save it under
   * @param clear if true, will force other caches to be removed (default false)
   */
  cacheLayout(nodes, column, clear = false) {
    const copy = [];
    nodes.forEach((n, i) => {
      if (n._id === void 0) {
        const existing = n.id ? this.nodes.find((n2) => n2.id === n.id) : void 0;
        n._id = existing?._id ?? _GridStackEngine._idSeq++;
      }
      copy[i] = { x: n.x, y: n.y, w: n.w, _id: n._id };
    });
    this._layouts = clear ? [] : this._layouts || [];
    this._layouts[column] = copy;
    return this;
  }
  /**
   * call to cache the given node layout internally to the given location so we can restore back when column changes size
   * @param node single node to cache
   * @param column corresponding column index to save it under
   */
  cacheOneLayout(n, column) {
    n._id = n._id ?? _GridStackEngine._idSeq++;
    const l = { x: n.x, y: n.y, w: n.w, _id: n._id };
    if (n.autoPosition || n.x === void 0) {
      delete l.x;
      delete l.y;
      if (n.autoPosition)
        l.autoPosition = true;
    }
    this._layouts = this._layouts || [];
    this._layouts[column] = this._layouts[column] || [];
    const index = this.findCacheLayout(n, column);
    if (index === -1)
      this._layouts[column].push(l);
    else
      this._layouts[column][index] = l;
    return this;
  }
  findCacheLayout(n, column) {
    return this._layouts?.[column]?.findIndex((l) => l._id === n._id) ?? -1;
  }
  removeNodeFromLayoutCache(n) {
    if (!this._layouts) {
      return;
    }
    for (let i = 0; i < this._layouts.length; i++) {
      const index = this.findCacheLayout(n, i);
      if (index !== -1) {
        this._layouts[i].splice(index, 1);
      }
    }
  }
  /** called to remove all internal values but the _id */
  cleanupNode(node) {
    const nd = node;
    for (const prop in nd) {
      if (prop[0] === "_" && prop !== "_id")
        delete nd[prop];
    }
    return this;
  }
};
GridStackEngine._idSeq = 0;

// node_modules/gridstack/dist/types.js
var gridDefaults = {
  alwaysShowResizeHandle: "mobile",
  animate: true,
  auto: true,
  cellHeight: "auto",
  cellHeightThrottle: 100,
  cellHeightUnit: "px",
  column: 12,
  draggable: { handle: ".grid-stack-item-content", appendTo: "body", scroll: true },
  handle: ".grid-stack-item-content",
  itemClass: "grid-stack-item",
  margin: 10,
  marginUnit: "px",
  maxRow: 0,
  minRow: 0,
  placeholderClass: "grid-stack-placeholder",
  placeholderText: "",
  removableOptions: { accept: "grid-stack-item", decline: "grid-stack-non-removable" },
  resizable: { handles: "se" },
  rtl: "auto"
  // **** same as not being set ****
  // disableDrag: false,
  // disableResize: false,
  // float: false,
  // handleClass: null,
  // removable: false,
  // staticGrid: false,
  //removable
};

// node_modules/gridstack/dist/dd-manager.js
var DDManager = class {
};

// node_modules/gridstack/dist/dd-touch.js
var isTouch = typeof window !== "undefined" && typeof document !== "undefined" && ("ontouchstart" in document || "ontouchstart" in window || window.DocumentTouch && document instanceof window.DocumentTouch || navigator.maxTouchPoints > 0 && window.matchMedia("(any-pointer: coarse)").matches || navigator.msMaxTouchPoints > 0);
var touchDragDelay = 300;
var touchDelayMoveThreshold = 10;
var DDTouch = class {
};
function preventDefaultEvent(e) {
  e.preventDefault();
}
function suppressContextMenu() {
  document.addEventListener("contextmenu", preventDefaultEvent, true);
  document.addEventListener("selectstart", preventDefaultEvent, true);
}
function restoreContextMenu() {
  document.removeEventListener("contextmenu", preventDefaultEvent, true);
  document.removeEventListener("selectstart", preventDefaultEvent, true);
}
function cancelDelayedTouchStart(target, onMove, onEnd) {
  target.removeEventListener("touchmove", onMove);
  target.removeEventListener("touchend", onEnd);
  target.removeEventListener("touchcancel", onEnd);
  cancelPendingTouchDrag();
}
function cancelPendingTouchDrag() {
  if (DDTouch.touchDelayTimer) {
    window.clearTimeout(DDTouch.touchDelayTimer);
    delete DDTouch.touchDelayTimer;
  }
  restoreContextMenu();
}
function simulateMouseEvent(e, simulatedType) {
  if (e.touches.length > 1)
    return;
  if (e.cancelable)
    e.preventDefault();
  Utils.simulateMouseEvent(e.changedTouches[0], simulatedType);
}
function simulatePointerMouseEvent(e, simulatedType) {
  if (e.cancelable)
    e.preventDefault();
  Utils.simulateMouseEvent(e, simulatedType);
}
function touchstart(e) {
  if (DDTouch.touchHandled)
    return;
  const target = e.currentTarget;
  const startX = e.touches[0].clientX;
  const startY = e.touches[0].clientY;
  const onEnd = () => cancelDelayedTouchStart(target, onMove, onEnd);
  const onMove = (ev) => {
    const t = ev.touches[0];
    if (Math.abs(t.clientX - startX) + Math.abs(t.clientY - startY) > touchDelayMoveThreshold)
      onEnd();
  };
  target.addEventListener("touchmove", onMove, { passive: true });
  target.addEventListener("touchend", onEnd, { passive: true });
  target.addEventListener("touchcancel", onEnd, { passive: true });
  DDTouch.touchDelayTimer = window.setTimeout(() => {
    cancelDelayedTouchStart(target, onMove, onEnd);
    DDTouch.touchHandled = true;
    DDTouch.wasDelayed = true;
    suppressContextMenu();
    simulateMouseEvent(e, "mousedown");
    delete DDTouch.wasDelayed;
  }, touchDragDelay);
}
function touchmove(e) {
  if (!DDTouch.touchHandled)
    return;
  simulateMouseEvent(e, "mousemove");
}
function touchend(e) {
  if (!DDTouch.touchHandled)
    return;
  restoreContextMenu();
  if (DDTouch.pointerLeaveTimeout) {
    window.clearTimeout(DDTouch.pointerLeaveTimeout);
    delete DDTouch.pointerLeaveTimeout;
  }
  const wasDragging = !!DDManager.dragElement;
  simulateMouseEvent(e, "mouseup");
  if (!wasDragging && e.type !== "touchcancel") {
    simulateMouseEvent(e, "click");
  }
  DDTouch.touchHandled = false;
}
function pointerdown(e) {
  if (e.pointerType === "mouse")
    return;
  e.target.releasePointerCapture(e.pointerId);
}
function pointerenter(e) {
  if (!DDManager.dragElement) {
    return;
  }
  if (e.pointerType === "mouse")
    return;
  simulatePointerMouseEvent(e, "mouseenter");
}
function pointerleave(e) {
  if (!DDManager.dragElement) {
    return;
  }
  if (e.pointerType === "mouse")
    return;
  DDTouch.pointerLeaveTimeout = window.setTimeout(() => {
    delete DDTouch.pointerLeaveTimeout;
    simulatePointerMouseEvent(e, "mouseleave");
  }, 10);
}

// node_modules/gridstack/dist/dd-resizable-handle.js
var DDResizableHandle = class _DDResizableHandle {
  constructor(host, dir, option) {
    this.host = host;
    this.dir = dir;
    this.option = option;
    this._mouseDown = this._mouseDown.bind(this);
    this._mouseMove = this._mouseMove.bind(this);
    this._mouseUp = this._mouseUp.bind(this);
    this._keyEvent = this._keyEvent.bind(this);
    this._init();
  }
  /** @internal */
  _init() {
    if (this.option.element) {
      try {
        this.el = this.option.element instanceof HTMLElement ? this.option.element : this.host.querySelector(this.option.element);
      } catch (error) {
        this.option.element = void 0;
        console.error("Query for resizeable handle failed, falling back", error);
      }
    }
    if (!this.el) {
      this.el = document.createElement("div");
      this.host.appendChild(this.el);
    }
    this.el.classList.add("ui-resizable-handle");
    this.el.classList.add(`${_DDResizableHandle.prefix}${this.dir}`);
    this.el.addEventListener("mousedown", this._mouseDown);
    if (isTouch) {
      this.el.addEventListener("touchstart", touchstart);
      this.el.addEventListener("pointerdown", pointerdown);
    }
    return this;
  }
  /** call this when resize handle needs to be removed and cleaned up */
  destroy() {
    if (this.mouseDownEvent)
      this._mouseUp(this.mouseDownEvent);
    cancelPendingTouchDrag();
    this.el.removeEventListener("mousedown", this._mouseDown);
    if (isTouch) {
      this.el.removeEventListener("touchstart", touchstart);
      this.el.removeEventListener("pointerdown", pointerdown);
    }
    if (!this.option.element) {
      this.host.removeChild(this.el);
    }
    return this;
  }
  /** @internal called on mouse down on us: capture move on the entire document (mouse might not stay on us) until we release the mouse */
  _mouseDown(e) {
    this.mouseDownEvent = e;
    document.addEventListener("mousemove", this._mouseMove, { capture: true, passive: true });
    document.addEventListener("mouseup", this._mouseUp, true);
    if (isTouch) {
      this.el.addEventListener("touchmove", touchmove);
      this.el.addEventListener("touchend", touchend);
      this.el.addEventListener("touchcancel", touchend);
    }
    if (DDTouch.wasDelayed) {
      this.el.classList.add("ui-resizable-armed");
    }
    e.stopPropagation();
    e.preventDefault();
  }
  /** @internal */
  _mouseMove(e) {
    const s = this.mouseDownEvent;
    if (this.moving) {
      this._triggerEvent("move", e);
    } else if (Math.abs(e.x - s.x) + Math.abs(e.y - s.y) > 2) {
      this.moving = true;
      this.el.classList.remove("ui-resizable-armed");
      this._triggerEvent("start", this.mouseDownEvent);
      this._triggerEvent("move", e);
      document.addEventListener("keydown", this._keyEvent);
    }
    e.stopPropagation();
  }
  /** @internal */
  _mouseUp(e) {
    if (this.moving) {
      this._triggerEvent("stop", e);
      document.removeEventListener("keydown", this._keyEvent);
    }
    this.el.classList.remove("ui-resizable-armed");
    document.removeEventListener("mousemove", this._mouseMove, true);
    document.removeEventListener("mouseup", this._mouseUp, true);
    if (isTouch) {
      this.el.removeEventListener("touchmove", touchmove);
      this.el.removeEventListener("touchend", touchend);
      this.el.removeEventListener("touchcancel", touchend);
    }
    delete this.moving;
    delete this.mouseDownEvent;
    e.stopPropagation();
    e.preventDefault();
  }
  /** @internal call when keys are being pressed - use Esc to cancel */
  _keyEvent(e) {
    if (e.key === "Escape") {
      this.host.gridstackNode?.grid?.engine.restoreInitial();
      this._mouseUp(this.mouseDownEvent);
    }
  }
  /** @internal */
  _triggerEvent(name, event2) {
    const opt = this.option;
    if (opt[name])
      opt[name](event2);
    return this;
  }
};
DDResizableHandle.prefix = "ui-resizable-";

// node_modules/gridstack/dist/dd-base-impl.js
var DDBaseImplement = class {
  constructor() {
    this._eventRegister = {};
  }
  /**
   * Returns the current disabled state (undefined if not set yet).
   * Note: Use enable()/disable() methods to change state as other operations need to happen.
   */
  get disabled() {
    return this._disabled;
  }
  /**
   * Register an event callback for the specified event.
   *
   * @param event - Event name to listen for
   * @param callback - Function to call when event occurs
   */
  on(event2, callback) {
    this._eventRegister[event2] = callback;
  }
  /**
   * Unregister an event callback for the specified event.
   *
   * @param event - Event name to stop listening for
   */
  off(event2) {
    delete this._eventRegister[event2];
  }
  /**
   * Enable this drag & drop implementation.
   * Subclasses should override to perform additional setup.
   */
  enable() {
    this._disabled = false;
  }
  /**
   * Disable this drag & drop implementation.
   * Subclasses should override to perform additional cleanup.
   */
  disable() {
    this._disabled = true;
  }
  /**
   * Destroy this drag & drop implementation and clean up resources.
   * Removes all event handlers and clears internal state.
   */
  destroy() {
    this._eventRegister = {};
  }
  /**
   * Trigger a registered event callback if one exists and the implementation is enabled.
   *
   * @param eventName - Name of the event to trigger
   * @param event - DOM event object to pass to the callback
   * @returns Result from the callback function, if any
   */
  triggerEvent(eventName, event2) {
    if (!this.disabled && this._eventRegister[eventName])
      return this._eventRegister[eventName](event2);
  }
};

// node_modules/gridstack/dist/dd-resizable.js
var DDResizable = class _DDResizable extends DDBaseImplement {
  // have to be public else complains for HTMLElementExtendOpt ?
  constructor(el2, option = {}) {
    super();
    this.el = el2;
    this.option = option;
    this.rectScale = { x: 1, y: 1 };
    this._ui = () => {
      const containmentEl = this.el.parentElement;
      const containmentRect = containmentEl.getBoundingClientRect();
      const newRect = {
        width: this.originalRect.width,
        height: this.originalRect.height + this.scrolled,
        left: this.originalRect.left,
        right: this.originalRect.right,
        top: this.originalRect.top - this.scrolled
      };
      const rect = this.temporalRect || newRect;
      const leftPos = this.option.rtl ? (containmentRect.right - rect.right) * this.rectScale.x : (rect.left - containmentRect.left) * this.rectScale.x;
      return {
        position: {
          left: leftPos,
          top: (rect.top - containmentRect.top) * this.rectScale.y
        },
        size: {
          width: rect.width * this.rectScale.x,
          height: rect.height * this.rectScale.y
        }
        /* Gridstack ONLY needs position set above... keep around in case.
        element: [this.el], // The object representing the element to be resized
        helper: [], // TODO: not support yet - The object representing the helper that's being resized
        originalElement: [this.el],// we don't wrap here, so simplify as this.el //The object representing the original element before it is wrapped
        originalPosition: { // The position represented as { left, top } before the resizable is resized
          left: this.originalRect.left - containmentRect.left,
          top: this.originalRect.top - containmentRect.top
        },
        originalSize: { // The size represented as { width, height } before the resizable is resized
          width: this.originalRect.width,
          height: this.originalRect.height
        }
        */
      };
    };
    this._mouseOver = this._mouseOver.bind(this);
    this._mouseOut = this._mouseOut.bind(this);
    this.enable();
    this._setupAutoHide(!!this.option.autoHide);
    this._setupHandlers();
  }
  on(event2, callback) {
    super.on(event2, callback);
  }
  off(event2) {
    super.off(event2);
  }
  enable() {
    super.enable();
    this.el.classList.remove("ui-resizable-disabled");
    this._setupAutoHide(!!this.option.autoHide);
  }
  disable() {
    super.disable();
    this.el.classList.add("ui-resizable-disabled");
    this._setupAutoHide(false);
  }
  destroy() {
    this._removeHandlers();
    this._setupAutoHide(false);
    delete this.el;
    super.destroy();
  }
  updateOption(opts) {
    const updateHandles = opts.handles && opts.handles !== this.option.handles;
    const updateAutoHide = opts.autoHide && opts.autoHide !== this.option.autoHide;
    Object.assign(this.option, opts);
    if (updateHandles) {
      this._removeHandlers();
      this._setupHandlers();
    }
    if (updateAutoHide) {
      this._setupAutoHide(!!this.option.autoHide);
    }
    return this;
  }
  /** @internal turns auto hide on/off */
  _setupAutoHide(auto) {
    if (auto) {
      this.el.classList.add("ui-resizable-autohide");
      this.el.addEventListener("mouseover", this._mouseOver);
      this.el.addEventListener("mouseout", this._mouseOut);
    } else {
      this.el.classList.remove("ui-resizable-autohide");
      this.el.removeEventListener("mouseover", this._mouseOver);
      this.el.removeEventListener("mouseout", this._mouseOut);
      if (DDManager.overResizeElement === this) {
        delete DDManager.overResizeElement;
      }
    }
    return this;
  }
  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _mouseOver(e) {
    if (DDManager.overResizeElement || DDManager.dragElement)
      return;
    DDManager.overResizeElement = this;
    this.el.classList.remove("ui-resizable-autohide");
  }
  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _mouseOut(e) {
    if (DDManager.overResizeElement !== this)
      return;
    delete DDManager.overResizeElement;
    this.el.classList.add("ui-resizable-autohide");
  }
  /** @internal */
  _setupHandlers() {
    this.handlers = (this.option.handles ?? "se").split(",").map((dir) => dir.trim()).map((dir) => new DDResizableHandle(this.el, dir, {
      element: this.option.element,
      start: (event2) => this._resizeStart(event2),
      stop: (event2) => this._resizeStop(event2),
      move: (event2) => this._resizing(event2, dir)
    }));
    return this;
  }
  /** @internal */
  _resizeStart(event2) {
    this.sizeToContent = Utils.shouldSizeToContent(this.el.gridstackNode, true);
    this.originalRect = this.el.getBoundingClientRect();
    this.scrollEl = Utils.getScrollElement(this.el);
    this.scrollY = this.scrollEl.scrollTop;
    this.scrolled = 0;
    this.startEvent = event2;
    Utils.pauseIframePointerEvents(true);
    this._setupHelper();
    this._applyChange();
    const ev = Utils.initEvent(event2, { type: "resizestart", target: this.el });
    if (this.option.start) {
      this.option.start(ev, this._ui());
    }
    this.el.classList.add("ui-resizable-resizing");
    this.triggerEvent("resizestart", ev);
    return this;
  }
  /** @internal */
  _resizing(event2, dir) {
    this.scrolled = this.scrollEl.scrollTop - this.scrollY;
    this.temporalRect = this._getChange(event2, dir);
    this._applyChange();
    const ev = Utils.initEvent(event2, { type: "resize", target: this.el });
    ev.resizeDir = dir;
    ev.hasMovedX = this.option.rtl ? dir.includes("e") : dir.includes("w");
    ev.hasMovedY = dir.includes("n");
    if (this.option.resize) {
      this.option.resize(ev, this._ui());
    }
    this.triggerEvent("resize", ev);
    return this;
  }
  /** @internal */
  _resizeStop(event2) {
    const ev = Utils.initEvent(event2, { type: "resizestop", target: this.el });
    Utils.pauseIframePointerEvents(false);
    this._cleanHelper();
    if (this.option.stop) {
      this.option.stop(ev);
    }
    this.el.classList.remove("ui-resizable-resizing");
    this.triggerEvent("resizestop", ev);
    delete this.startEvent;
    delete this.originalRect;
    delete this.temporalRect;
    delete this.scrollY;
    delete this.scrolled;
    return this;
  }
  /** @internal */
  _setupHelper() {
    this.elOriginStyleVal = _DDResizable._originStyleProp.map((prop) => this.el.style[prop]);
    const parentEl = this.el.parentElement;
    this.parentOriginStylePosition = parentEl.style.position;
    const dragTransform = Utils.getValuesFromTransformedElement(parentEl);
    this.rectScale = {
      x: dragTransform.xScale,
      y: dragTransform.yScale
    };
    if (getComputedStyle(parentEl).position.match(/static/)) {
      parentEl.style.position = "relative";
    }
    this.el.style.position = "absolute";
    this.el.style.opacity = "0.8";
    return this;
  }
  /** @internal */
  _cleanHelper() {
    _DDResizable._originStyleProp.forEach((prop, i) => {
      this.el.style[prop] = this.elOriginStyleVal[i] || null;
    });
    this.el.parentElement.style.position = this.parentOriginStylePosition || null;
    return this;
  }
  /** @internal */
  _getChange(event2, dir) {
    const oEvent = this.startEvent;
    const newRect = {
      width: this.originalRect.width,
      height: this.originalRect.height + this.scrolled,
      left: this.originalRect.left,
      right: this.originalRect.right,
      top: this.originalRect.top - this.scrolled
    };
    const offsetX = event2.clientX - oEvent.clientX;
    const offsetY = this.sizeToContent ? 0 : event2.clientY - oEvent.clientY;
    let moveLeft = false;
    let moveUp = false;
    const isRtl = this.option.rtl;
    if (!isRtl && dir.indexOf("e") > -1) {
      newRect.width += offsetX;
    } else if (isRtl && dir.indexOf("w") > -1) {
      newRect.width -= offsetX;
    } else if (!isRtl && dir.indexOf("w") > -1) {
      newRect.width -= offsetX;
      newRect.left += offsetX;
      moveLeft = true;
    } else if (isRtl && dir.indexOf("e") > -1) {
      newRect.width += offsetX;
      newRect.right += offsetX;
      moveLeft = true;
    }
    if (dir.indexOf("s") > -1) {
      newRect.height += offsetY;
    } else if (dir.indexOf("n") > -1) {
      newRect.height -= offsetY;
      newRect.top += offsetY;
      moveUp = true;
    }
    const constrain = this._constrainSize(newRect.width, newRect.height, moveLeft, moveUp);
    if (Math.round(newRect.width) !== Math.round(constrain.width)) {
      if (!isRtl && dir.indexOf("w") > -1) {
        newRect.left += newRect.width - constrain.width;
      } else if (isRtl && dir.indexOf("e") > -1) {
        newRect.right -= newRect.width - constrain.width;
      }
      newRect.width = constrain.width;
    }
    if (Math.round(newRect.height) !== Math.round(constrain.height)) {
      if (dir.indexOf("n") > -1) {
        newRect.top += newRect.height - constrain.height;
      }
      newRect.height = constrain.height;
    }
    return newRect;
  }
  /** @internal constrain the size to the set min/max values */
  _constrainSize(oWidth, oHeight, moveLeft, moveUp) {
    const o = this.option;
    const maxWidth = (moveLeft ? o.maxWidthMoveLeft : o.maxWidth) || Number.MAX_SAFE_INTEGER;
    const minWidth = (o.minWidth ?? 0) / this.rectScale.x || oWidth;
    const maxHeight = (moveUp ? o.maxHeightMoveUp : o.maxHeight) || Number.MAX_SAFE_INTEGER;
    const minHeight = (o.minHeight ?? 0) / this.rectScale.y || oHeight;
    const width = Math.min(maxWidth, Math.max(minWidth, oWidth));
    const height = Math.min(maxHeight, Math.max(minHeight, oHeight));
    return { width, height };
  }
  /** @internal */
  _applyChange() {
    let containmentRect = { left: 0, right: 0, top: 0, width: 0, height: 0 };
    if (this.el.style.position === "absolute") {
      const containmentEl = this.el.parentElement;
      const { left, right, top } = containmentEl.getBoundingClientRect();
      containmentRect = { left, right, top, width: 0, height: 0 };
    }
    if (!this.temporalRect)
      return this;
    const cRect = containmentRect;
    Object.entries(this.temporalRect).forEach(([key, value]) => {
      if (this.option.rtl ? key === "left" : key === "right")
        return;
      const scaleReciprocal = key === "width" || key === "left" || key === "right" ? this.rectScale.x : key === "height" || key === "top" ? this.rectScale.y : 1;
      let finalValue;
      if (key === "right") {
        finalValue = (containmentRect.right - value) * this.rectScale.x + "px";
      } else {
        finalValue = (value - cRect[key]) * scaleReciprocal + "px";
      }
      this.el.style[key] = finalValue;
    });
    return this;
  }
  /** @internal */
  _removeHandlers() {
    this.handlers.forEach((handle) => handle.destroy());
    delete this.handlers;
    return this;
  }
};
DDResizable._originStyleProp = ["width", "height", "position", "left", "right", "top", "opacity", "zIndex"];

// node_modules/gridstack/dist/dd-draggable.js
var skipMouseDown = 'input,textarea,button,select,option,[contenteditable="true"],.ui-resizable-handle';
var DDDraggable = class _DDDraggable extends DDBaseImplement {
  constructor(el2, option = {}) {
    super();
    this.el = el2;
    this.option = option;
    this.dragTransform = {
      xScale: 1,
      yScale: 1,
      xOffset: 0,
      yOffset: 0
    };
    this._autoScrollTick = () => {
      const el3 = this.helper;
      const scrollCont = this._autoScrollContainer;
      if (!el3 || !scrollCont) {
        this._stopScrolling();
        return;
      }
      const clipping = this._getClipping(el3, scrollCont);
      if (clipping === 0) {
        this._stopScrolling();
        return;
      }
      if (!this._autoScrollMaxSpeed) {
        const viewportH = window.innerHeight || document.documentElement.clientHeight;
        this._autoScrollMaxSpeed = Math.max(viewportH / 150, 4);
      }
      const absPx = Math.abs(clipping);
      const speed = Math.min(absPx * 0.5, this._autoScrollMaxSpeed);
      const scrollAmount = clipping > 0 ? speed : -speed;
      const prevScroll = scrollCont.scrollTop;
      scrollCont.scrollTop += scrollAmount;
      if (scrollCont.scrollTop === prevScroll) {
        this._stopScrolling();
        return;
      }
      if (this.dragging && this.lastDrag) {
        this._dragFollow(this.lastDrag);
        this._callDrag(this.lastDrag);
      }
      this._autoScrollAnimId = requestAnimationFrame(this._autoScrollTick);
    };
    const handleName = option?.handle?.substring(1);
    const n = el2.gridstackNode;
    this.dragEls = !handleName || el2.classList.contains(handleName) ? [el2] : n?.subGrid ? [el2.querySelector(option.handle) || el2] : this.getAllHandles();
    if (this.dragEls.length === 0) {
      this.dragEls = [el2];
    }
    this._mouseDown = this._mouseDown.bind(this);
    this._mouseMove = this._mouseMove.bind(this);
    this._mouseUp = this._mouseUp.bind(this);
    this._keyEvent = this._keyEvent.bind(this);
    this.enable();
  }
  /** return all handles omitting other nested `.grid-stack-item` children (in case node.subGrid isn't set for some reason) */
  getAllHandles() {
    return Array.from(this.el.querySelectorAll(this.option.handle)).filter((node) => {
      if (!(node instanceof HTMLElement))
        return false;
      const owner = node.closest(".grid-stack-item");
      return owner === this.el || !owner;
    });
  }
  on(event2, callback) {
    super.on(event2, callback);
  }
  off(event2) {
    super.off(event2);
  }
  enable() {
    if (this.disabled === false)
      return;
    super.enable();
    this.dragEls.forEach((dragEl) => {
      dragEl.addEventListener("mousedown", this._mouseDown);
      if (isTouch) {
        dragEl.addEventListener("touchstart", touchstart);
        dragEl.addEventListener("pointerdown", pointerdown);
      }
    });
    this.el.classList.remove("ui-draggable-disabled");
  }
  disable(forDestroy = false) {
    if (this.disabled === true)
      return;
    super.disable();
    cancelPendingTouchDrag();
    this.dragEls.forEach((dragEl) => {
      dragEl.removeEventListener("mousedown", this._mouseDown);
      if (isTouch) {
        dragEl.removeEventListener("touchstart", touchstart);
        dragEl.removeEventListener("pointerdown", pointerdown);
      }
    });
    if (!forDestroy)
      this.el.classList.add("ui-draggable-disabled");
  }
  destroy() {
    if (this.dragTimeout)
      window.clearTimeout(this.dragTimeout);
    delete this.dragTimeout;
    if (this.mouseDownEvent)
      this._mouseUp(this.mouseDownEvent);
    this.disable(true);
    delete this.el;
    delete this.option;
    super.destroy();
  }
  updateOption(opts) {
    Object.assign(this.option, opts);
    return this;
  }
  /**
   * Re-scans the item element for drag-handle elements after delayed content (React portal,
   * Angular component, etc.) has been rendered into the item.  Removes listeners from the
   * previous handle set, re-queries, then re-attaches.
   * Not needed for the default `.grid-stack-item-content` handle which is always present.
   */
  refreshHandles() {
    const wasDisabled = this.disabled;
    if (!wasDisabled)
      this.disable(true);
    const handleName = this.option?.handle?.substring(1);
    const n = this.el.gridstackNode;
    this.dragEls = !handleName || this.el.classList.contains(handleName) ? [this.el] : n?.subGrid ? [this.el.querySelector(this.option.handle) || this.el] : this.getAllHandles();
    if (this.dragEls.length === 0)
      this.dragEls = [this.el];
    if (!wasDisabled)
      this.enable();
  }
  /** @internal call when mouse goes down before a dragstart happens */
  _mouseDown(e) {
    if (e.isTrusted) {
      if (DDTouch.touchHandled)
        DDTouch.touchHandled = false;
      if (DDManager.mouseHandled && e.timeStamp !== DDManager.mouseHandledTimeStamp)
        delete DDManager.mouseHandled;
    }
    if (DDManager.mouseHandled)
      return true;
    if (e.button !== 0)
      return true;
    if (!this.dragEls.find((el2) => el2 === e.target) && e.target.closest(skipMouseDown))
      return true;
    if (this.option.cancel) {
      if (e.target.closest(this.option.cancel))
        return true;
    }
    this.mouseDownEvent = e;
    delete this.dragging;
    delete DDManager.dragElement;
    delete DDManager.dropElement;
    delete this._autoScrollMaxSpeed;
    delete this._autoScrollContainer;
    document.addEventListener("mousemove", this._mouseMove, { capture: true, passive: true });
    document.addEventListener("mouseup", this._mouseUp, true);
    if (isTouch && e.currentTarget) {
      e.currentTarget.addEventListener("touchmove", touchmove);
      e.currentTarget.addEventListener("touchend", touchend);
      e.currentTarget.addEventListener("touchcancel", touchend);
    }
    if (DDTouch.wasDelayed) {
      this.el.classList.add("ui-draggable-armed");
    }
    e.preventDefault();
    if (document.activeElement)
      document.activeElement.blur();
    DDManager.mouseHandled = true;
    DDManager.mouseHandledTimeStamp = e.timeStamp;
    return true;
  }
  /** @internal method to call actual drag event */
  _callDrag(e) {
    if (!this.dragging)
      return;
    const ev = Utils.initEvent(e, { target: this.el, type: "drag" });
    if (this.option.drag) {
      this.option.drag(ev, this.ui());
    }
    this.triggerEvent("drag", ev);
  }
  /** @internal called when the main page (after successful mousedown) receives a move event to drag the item around the screen */
  _mouseMove(e) {
    const s = this.mouseDownEvent;
    this.lastDrag = e;
    if (this.dragging) {
      this._dragFollow(e);
      if (DDManager.pauseDrag) {
        const pause = Number.isInteger(DDManager.pauseDrag) ? DDManager.pauseDrag : 100;
        if (this.dragTimeout)
          window.clearTimeout(this.dragTimeout);
        this.dragTimeout = window.setTimeout(() => this._callDrag(e), pause);
      } else {
        this._callDrag(e);
      }
    } else if (Math.abs(e.x - s.x) + Math.abs(e.y - s.y) > 3) {
      this.dragging = true;
      Utils.pauseIframePointerEvents(true);
      this.el.classList.remove("ui-draggable-armed");
      DDManager.dragElement = this;
      const grid = this.el.gridstackNode?.grid;
      if (grid) {
        DDManager.dropElement = grid.el.ddElement?.ddDroppable;
      } else {
        delete DDManager.dropElement;
      }
      this.helper = this._createHelper();
      this._setupHelperContainmentStyle();
      this.dragTransform = Utils.getValuesFromTransformedElement(this.helperContainment);
      this.dragOffset = this._getDragOffset(e, this.el, this.helperContainment);
      this._setupHelperStyle(e);
      const ev = Utils.initEvent(e, { target: this.el, type: "dragstart" });
      if (this.option.start) {
        this.option.start(ev, this.ui());
      }
      this.triggerEvent("dragstart", ev);
      document.addEventListener("keydown", this._keyEvent);
    }
    return true;
  }
  /** @internal call when the mouse gets released to drop the item at current location */
  _mouseUp(e) {
    this._stopScrolling();
    this.el.classList.remove("ui-draggable-armed");
    document.removeEventListener("mousemove", this._mouseMove, true);
    document.removeEventListener("mouseup", this._mouseUp, true);
    if (isTouch && e.currentTarget) {
      e.currentTarget.removeEventListener("touchmove", touchmove, true);
      e.currentTarget.removeEventListener("touchend", touchend, true);
      e.currentTarget.removeEventListener("touchcancel", touchend, true);
    }
    if (this.dragging) {
      delete this.dragging;
      Utils.pauseIframePointerEvents(false);
      delete this.el.gridstackNode?._origRotate;
      document.removeEventListener("keydown", this._keyEvent);
      if (DDManager.dropElement?.el === this.el.parentElement) {
        delete DDManager.dropElement;
      }
      this.helperContainment.style.position = this.parentOriginStylePosition || null;
      if (this.helper && this.helper !== this.el)
        this.helper.remove();
      this._removeHelperStyle();
      const ev = Utils.initEvent(e, { target: this.el, type: "dragstop" });
      if (this.option.stop) {
        this.option.stop(ev);
      }
      this.triggerEvent("dragstop", ev);
      if (DDManager.dropElement) {
        DDManager.dropElement.drop(e);
      }
    }
    delete this.helper;
    delete this.mouseDownEvent;
    delete DDManager.dragElement;
    delete DDManager.dropElement;
    delete DDManager.mouseHandled;
    delete DDManager.mouseHandledTimeStamp;
    e.preventDefault();
  }
  /** @internal call when keys are being pressed - use Esc to cancel, R to rotate */
  _keyEvent(e) {
    const n = this.el.gridstackNode;
    const grid = n?.grid || DDManager.dropElement?.el?.gridstack;
    if (e.key === "Escape") {
      if (n && n._origRotate) {
        n._orig = n._origRotate;
        delete n._origRotate;
      }
      grid?.cancelDrag();
      this._mouseUp(this.mouseDownEvent);
    } else if (n && grid && (e.key === "r" || e.key === "R")) {
      if (!Utils.canBeRotated(n))
        return;
      n._origRotate = n._origRotate || { ...n._orig };
      delete n._moving;
      grid.setAnimation(false).rotate(n.el, {
        top: -this.dragOffset.offsetTop,
        left: -this.dragOffset.offsetX
      }).setAnimation();
      n._moving = true;
      this.dragOffset = this._getDragOffset(this.lastDrag, n.el, this.helperContainment);
      this.helper.style.width = this.dragOffset.width + "px";
      this.helper.style.height = this.dragOffset.height + "px";
      Utils.swap(n._orig, "w", "h");
      delete n._rect;
      this._mouseMove(this.lastDrag);
    }
  }
  /** @internal create a clone copy (or user defined method) of the original drag item if set */
  _createHelper() {
    let helper = this.el;
    if (typeof this.option.helper === "function") {
      helper = this.option.helper(this.el);
    } else if (this.option.helper === "clone") {
      helper = Utils.cloneNode(this.el);
    }
    if (!helper.parentElement) {
      Utils.appendTo(helper, this.option.appendTo === "parent" ? this.el.parentElement : this.option.appendTo ?? "body");
    }
    this.dragElementOriginStyle = _DDDraggable.originStyleProp.map((prop) => this.el.style[prop]);
    return helper;
  }
  /** @internal set the fix position of the dragged item */
  _setupHelperStyle(e) {
    this.helper.classList.add("ui-draggable-dragging");
    this.el.gridstackNode?.grid?.el.classList.add("grid-stack-dragging");
    const style = this.helper.style;
    style.pointerEvents = "none";
    style.width = this.dragOffset.width + "px";
    style.height = this.dragOffset.height + "px";
    style.willChange = "left, right, top";
    style.position = "fixed";
    this._dragFollow(e);
    style.transition = "none";
    setTimeout(() => {
      if (this.helper) {
        style.transition = null;
      }
    }, 0);
    return this;
  }
  /** @internal restore back the original style before dragging */
  _removeHelperStyle() {
    this.helper.classList.remove("ui-draggable-dragging");
    (this.el._gridstackNodeOrig || this.el.gridstackNode)?.grid?.el.classList.remove("grid-stack-dragging");
    const node = this.helper?.gridstackNode;
    if (!node?._isAboutToRemove && this.dragElementOriginStyle) {
      const helper = this.helper;
      const originStyle = this.dragElementOriginStyle;
      const idxOf = _DDDraggable.originStyleProp.indexOf("transition");
      const transition = originStyle[idxOf] || null;
      helper.style.transition = originStyle[idxOf] = "none";
      const hStyle = helper.style;
      _DDDraggable.originStyleProp.forEach((prop, i) => hStyle[prop] = originStyle[i] || null);
      setTimeout(() => helper.style.transition = transition || "", 50);
    }
    delete this.dragElementOriginStyle;
    return this;
  }
  /** @internal updates the top/left position to follow the mouse */
  _dragFollow(e) {
    const style = this.helper.style;
    const offset = this.dragOffset;
    if (this.option.rtl) {
      style.right = (window.innerWidth - e.clientX + offset.offsetX) * this.dragTransform.xScale + "px";
      if (style.left)
        style.left = "";
    } else {
      style.left = (e.clientX + offset.offsetX) * this.dragTransform.xScale + "px";
      if (style.right)
        style.right = "";
    }
    style.top = (e.clientY + offset.offsetTop) * this.dragTransform.yScale + "px";
  }
  /** @internal */
  _setupHelperContainmentStyle() {
    this.helperContainment = this.helper.parentElement;
    if (this.helper.style.position !== "fixed") {
      this.parentOriginStylePosition = this.helperContainment.style.position;
      if (getComputedStyle(this.helperContainment).position.match(/static/)) {
        this.helperContainment.style.position = "relative";
      }
    }
    return this;
  }
  /** @internal */
  _getDragOffset(event2, el2, parent) {
    let xformOffsetX = 0;
    let xformOffsetY = 0;
    if (parent) {
      xformOffsetX = this.dragTransform.xOffset;
      xformOffsetY = this.dragTransform.yOffset;
    }
    const targetOffset = el2.getBoundingClientRect();
    let x = this.option.rtl ? targetOffset.right : targetOffset.left;
    let offsetX = this.option.rtl ? event2.clientX - targetOffset.right + xformOffsetX : -event2.clientX + targetOffset.left - xformOffsetX;
    return {
      x,
      top: targetOffset.top,
      offsetX,
      offsetTop: -event2.clientY + targetOffset.top - xformOffsetY,
      width: targetOffset.width * this.dragTransform.xScale,
      height: targetOffset.height * this.dragTransform.yScale
    };
  }
  /** @internal starts or continues auto-scroll when the dragged helper is clipped by the scroll container.
   * Takes the grid's own element to find the scroll container so external/sidebar drags work too (#2074). */
  updateScrollPosition(gridEl) {
    this._autoScrollContainer = Utils.getScrollElement(gridEl);
    const clipping = this._getClipping(this.helper, this._autoScrollContainer);
    if (clipping === 0) {
      this._stopScrolling();
    } else if (!this._autoScrollAnimId) {
      this._autoScrollAnimId = requestAnimationFrame(this._autoScrollTick);
    }
  }
  /** @internal compute how many pixels the element is clipped: negative = above, positive = below, 0 = fully inside OR outside (stop scrolling) */
  _getClipping(el2, scrollEl) {
    const elRect = el2.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    if (elRect.bottom < scrollRect.top || elRect.top > scrollRect.bottom)
      return 0;
    const clippedBelow = elRect.bottom - Math.min(scrollRect.bottom, viewportH);
    const clippedAbove = elRect.top - Math.max(scrollRect.top, 0);
    if (clippedAbove < 0)
      return clippedAbove;
    if (clippedBelow > 0)
      return clippedBelow;
    return 0;
  }
  /** @internal stop any active auto-scroll animation */
  _stopScrolling() {
    if (this._autoScrollAnimId) {
      cancelAnimationFrame(this._autoScrollAnimId);
      delete this._autoScrollAnimId;
    }
  }
  /** @internal TODO: set to public as called by DDDroppable! */
  ui() {
    const containmentEl = this.el.parentElement;
    const containmentRect = containmentEl.getBoundingClientRect();
    const offset = this.helper.getBoundingClientRect();
    const leftPos = this.option.rtl ? (containmentRect.right - offset.right) * this.dragTransform.xScale : (offset.left - containmentRect.left) * this.dragTransform.xScale;
    return {
      position: {
        top: (offset.top - containmentRect.top) * this.dragTransform.yScale,
        left: leftPos
      }
      /* not used by GridStack for now...
      helper: [this.helper], //The object arr representing the helper that's being dragged.
      offset: { top: offset.top, left: offset.left } // Current offset position of the helper as { top, left } object.
      */
    };
  }
};
DDDraggable.originStyleProp = ["width", "height", "transform", "transform-origin", "transition", "pointerEvents", "position", "left", "right", "top", "minWidth", "willChange"];

// node_modules/gridstack/dist/dd-droppable.js
var DDDroppable = class extends DDBaseImplement {
  constructor(el2, option = {}) {
    super();
    this.el = el2;
    this.option = option;
    this._mouseEnter = this._mouseEnter.bind(this);
    this._mouseLeave = this._mouseLeave.bind(this);
    this.eventEl = this.el.closest(".grid-stack-item") || this.el;
    this.enable();
    this._setupAccept();
  }
  on(event2, callback) {
    super.on(event2, callback);
  }
  off(event2) {
    super.off(event2);
  }
  enable() {
    if (this.disabled === false)
      return;
    super.enable();
    this.el.classList.add("ui-droppable");
    this.el.classList.remove("ui-droppable-disabled");
    this.eventEl.addEventListener("mouseenter", this._mouseEnter);
    this.eventEl.addEventListener("mouseleave", this._mouseLeave);
    if (isTouch) {
      this.eventEl.addEventListener("pointerenter", pointerenter);
      this.eventEl.addEventListener("pointerleave", pointerleave);
    }
  }
  disable(forDestroy = false) {
    if (this.disabled === true)
      return;
    super.disable();
    this.el.classList.remove("ui-droppable");
    if (!forDestroy)
      this.el.classList.add("ui-droppable-disabled");
    this.eventEl.removeEventListener("mouseenter", this._mouseEnter);
    this.eventEl.removeEventListener("mouseleave", this._mouseLeave);
    if (isTouch) {
      this.eventEl.removeEventListener("pointerenter", pointerenter);
      this.eventEl.removeEventListener("pointerleave", pointerleave);
    }
  }
  destroy() {
    this.disable(true);
    this.el.classList.remove("ui-droppable");
    this.el.classList.remove("ui-droppable-disabled");
    super.destroy();
  }
  updateOption(opts) {
    Object.assign(this.option, opts);
    this._setupAccept();
    return this;
  }
  /** @internal called when the cursor enters our area - prepare for a possible drop and track leaving */
  _mouseEnter(e) {
    if (!DDManager.dragElement)
      return;
    if (DDTouch.touchHandled && e.isTrusted)
      return;
    if (!this._canDrop(DDManager.dragElement.el))
      return;
    e.preventDefault();
    e.stopPropagation();
    DDManager.dragElement._stopScrolling();
    if (DDManager.dropElement && DDManager.dropElement !== this) {
      DDManager.dropElement._mouseLeave(e, true);
    }
    DDManager.dropElement = this;
    const ev = Utils.initEvent(e, { target: this.el, type: "dropover" });
    if (this.option.over) {
      this.option.over(ev, this._ui(DDManager.dragElement));
    }
    this.triggerEvent("dropover", ev);
    this.el.classList.add("ui-droppable-over");
  }
  /** @internal called when the item is leaving our area, stop tracking if we had moving item */
  _mouseLeave(e, calledByEnter = false) {
    if (!DDManager.dragElement || DDManager.dropElement !== this)
      return;
    e.preventDefault();
    e.stopPropagation();
    if (calledByEnter)
      DDManager.dragElement._stopScrolling();
    const ev = Utils.initEvent(e, { target: this.el, type: "dropout" });
    if (this.option.out) {
      this.option.out(ev, this._ui(DDManager.dragElement));
    }
    this.triggerEvent("dropout", ev);
    if (DDManager.dropElement === this) {
      delete DDManager.dropElement;
      if (!calledByEnter) {
        let parentDrop;
        let parent = this.el.parentElement;
        while (!parentDrop && parent) {
          parentDrop = parent.ddElement?.ddDroppable;
          parent = parent.parentElement;
        }
        if (parentDrop) {
          parentDrop._mouseEnter(e);
        }
      }
    }
  }
  /** item is being dropped on us - called by the drag mouseup handler - this calls the client drop event */
  drop(e) {
    e.preventDefault();
    const ev = Utils.initEvent(e, { target: this.el, type: "drop" });
    if (this.option.drop) {
      this.option.drop(ev, this._ui(DDManager.dragElement));
    }
    this.triggerEvent("drop", ev);
  }
  /** @internal true if element matches the string/method accept option */
  _canDrop(el2) {
    return el2 && (!this.accept || this.accept(el2));
  }
  /** @internal */
  _setupAccept() {
    if (!this.option.accept)
      return this;
    if (typeof this.option.accept === "string") {
      this.accept = (el2) => el2.classList.contains(this.option.accept) || el2.matches(this.option.accept);
    } else {
      this.accept = this.option.accept;
    }
    return this;
  }
  /** @internal */
  _ui(drag) {
    return {
      draggable: drag.el,
      ...drag.ui()
    };
  }
};

// node_modules/gridstack/dist/dd-element.js
var DDElement = class _DDElement {
  static init(el2) {
    if (!el2.ddElement) {
      el2.ddElement = new _DDElement(el2);
    }
    return el2.ddElement;
  }
  constructor(el2) {
    this.el = el2;
  }
  on(eventName, callback) {
    if (this.ddDraggable && ["drag", "dragstart", "dragstop"].indexOf(eventName) > -1) {
      this.ddDraggable.on(eventName, callback);
    } else if (this.ddDroppable && ["drop", "dropover", "dropout"].indexOf(eventName) > -1) {
      this.ddDroppable.on(eventName, callback);
    } else if (this.ddResizable && ["resizestart", "resize", "resizestop"].indexOf(eventName) > -1) {
      this.ddResizable.on(eventName, callback);
    }
    return this;
  }
  off(eventName) {
    if (this.ddDraggable && ["drag", "dragstart", "dragstop"].indexOf(eventName) > -1) {
      this.ddDraggable.off(eventName);
    } else if (this.ddDroppable && ["drop", "dropover", "dropout"].indexOf(eventName) > -1) {
      this.ddDroppable.off(eventName);
    } else if (this.ddResizable && ["resizestart", "resize", "resizestop"].indexOf(eventName) > -1) {
      this.ddResizable.off(eventName);
    }
    return this;
  }
  setupDraggable(opts) {
    if (!this.ddDraggable) {
      this.ddDraggable = new DDDraggable(this.el, opts);
    } else {
      this.ddDraggable.updateOption(opts);
    }
    return this;
  }
  cleanDraggable() {
    if (this.ddDraggable) {
      this.ddDraggable.destroy();
      delete this.ddDraggable;
    }
    return this;
  }
  setupResizable(opts) {
    if (!this.ddResizable) {
      this.ddResizable = new DDResizable(this.el, opts);
    } else {
      this.ddResizable.updateOption(opts);
    }
    return this;
  }
  cleanResizable() {
    if (this.ddResizable) {
      this.ddResizable.destroy();
      delete this.ddResizable;
    }
    return this;
  }
  setupDroppable(opts) {
    if (!this.ddDroppable) {
      this.ddDroppable = new DDDroppable(this.el, opts);
    } else {
      this.ddDroppable.updateOption(opts);
    }
    return this;
  }
  cleanDroppable() {
    if (this.ddDroppable) {
      this.ddDroppable.destroy();
      delete this.ddDroppable;
    }
    return this;
  }
};

// node_modules/gridstack/dist/dd-gridstack.js
var DDGridStack = class {
  /**
   * Enable/disable/configure resizing for grid elements.
   *
   * @param el - Grid item element(s) to configure
   * @param opts - Resize options or command ('enable', 'disable', 'destroy', 'option', or config object)
   * @param key - Option key when using 'option' command
   * @param value - Option value when using 'option' command
   * @returns this instance for chaining
   *
   * @example
   * dd.resizable(element, 'enable');  // Enable resizing
   * dd.resizable(element, 'option', 'minWidth', 100);  // Set minimum width
   */
  resizable(el2, opts, key, value) {
    this._getDDElements(el2, typeof opts === "string" ? opts : void 0).forEach((dEl) => {
      if (opts === "disable" || opts === "enable") {
        dEl.ddResizable && dEl.ddResizable[opts]();
      } else if (opts === "destroy") {
        dEl.ddResizable && dEl.cleanResizable();
      } else if (opts === "option") {
        dEl.setupResizable({ [key]: value });
      } else {
        const n = dEl.el.gridstackNode;
        const grid = n.grid;
        let handles = dEl.el.getAttribute("gs-resize-handles") || grid.opts.resizable.handles || "e,s,se";
        if (handles === "all")
          handles = "n,e,s,w,se,sw,ne,nw";
        const autoHide = !grid.opts.alwaysShowResizeHandle;
        const resOpts = opts;
        dEl.setupResizable({
          ...grid.opts.resizable,
          ...{ handles, autoHide },
          ...{
            start: resOpts.start,
            stop: resOpts.stop,
            resize: resOpts.resize,
            rtl: resOpts.rtl
          }
        });
      }
    });
    return this;
  }
  /**
   * Enable/disable/configure dragging for grid elements.
   *
   * @param el - Grid item element(s) to configure
   * @param opts - Drag options or command ('enable', 'disable', 'destroy', 'option', or config object)
   * @param key - Option key when using 'option' command
   * @param value - Option value when using 'option' command
   * @param rtl - Are we in rtl mode?
   * @returns this instance for chaining
   *
   * @example
   * dd.draggable(element, 'enable');  // Enable dragging
   * dd.draggable(element, {handle: '.drag-handle'});  // Configure drag handle
   */
  draggable(el2, opts, key, value) {
    this._getDDElements(el2, typeof opts === "string" ? opts : void 0).forEach((dEl) => {
      if (opts === "disable" || opts === "enable") {
        dEl.ddDraggable && dEl.ddDraggable[opts]();
      } else if (opts === "destroy") {
        dEl.ddDraggable && dEl.cleanDraggable();
      } else if (opts === "option") {
        dEl.setupDraggable({ [key]: value });
      } else {
        const grid = dEl.el.gridstackNode.grid;
        const dragOpts = opts;
        dEl.setupDraggable({
          ...grid.opts.draggable,
          ...{
            // containment: (grid.parentGridNode && grid.opts.dragOut === false) ? grid.el.parentElement : (grid.opts.draggable.containment || null),
            start: dragOpts.start,
            stop: dragOpts.stop,
            drag: dragOpts.drag,
            rtl: dragOpts.rtl
          }
        });
      }
    });
    return this;
  }
  dragIn(el2, opts) {
    this._getDDElements(el2).forEach((dEl) => dEl.setupDraggable(opts));
    return this;
  }
  droppable(el2, opts, key, value) {
    if (typeof opts !== "string") {
      const o = opts;
      if (typeof o.accept === "function" && !o._accept) {
        o._accept = o.accept;
        o.accept = (el3) => o._accept(el3);
      }
    }
    const ddOpts = typeof opts === "string" ? opts : void 0;
    this._getDDElements(el2, ddOpts).forEach((dEl) => {
      if (opts === "disable" || opts === "enable") {
        dEl.ddDroppable && dEl.ddDroppable[opts]();
      } else if (opts === "destroy") {
        dEl.ddDroppable && dEl.cleanDroppable();
      } else if (opts === "option") {
        dEl.setupDroppable({ [key]: value });
      } else {
        dEl.setupDroppable(opts);
      }
    });
    return this;
  }
  /** true if element is droppable */
  isDroppable(el2) {
    return !!(el2?.ddElement?.ddDroppable && !el2.ddElement.ddDroppable.disabled);
  }
  /** true if element is draggable */
  isDraggable(el2) {
    return !!(el2?.ddElement?.ddDraggable && !el2.ddElement.ddDraggable.disabled);
  }
  /** true if element is draggable */
  isResizable(el2) {
    return !!(el2?.ddElement?.ddResizable && !el2.ddElement.ddResizable.disabled);
  }
  on(el2, name, callback) {
    this._getDDElements(el2).forEach((dEl) => dEl.on(name, (event2) => {
      callback(event2, DDManager.dragElement ? DDManager.dragElement.el : event2.target, DDManager.dragElement ? DDManager.dragElement.helper : void 0);
    }));
    return this;
  }
  off(el2, name) {
    this._getDDElements(el2).forEach((dEl) => dEl.off(name));
    return this;
  }
  /** @internal returns a list of DD elements, creating them on the fly by default unless option is to destroy or disable */
  _getDDElements(els, opts) {
    const create = els.gridstack || opts !== "destroy" && opts !== "disable";
    const hosts = Utils.getElements(els);
    if (!hosts.length)
      return [];
    const list = hosts.map((e) => e.ddElement || (create ? DDElement.init(e) : null)).filter((d) => !!d);
    return list;
  }
};

// node_modules/gridstack/dist/gridstack.js
var dd = new DDGridStack();
var GridStack = class _GridStack {
  /**
   * initializing the HTML element, or selector string, into a grid will return the grid. Calling it again will
   * simply return the existing instance (ignore any passed options). There is also an initAll() version that support
   * multiple grids initialization at once. Or you can use addGrid() to create the entire grid from JSON.
   * @param options grid options (optional)
   * @param elOrString element or CSS selector (first one used) to convert to a grid (default to '.grid-stack' class selector)
   *
   * @example
   * const grid = GridStack.init();
   *
   * Note: the HTMLElement (of type GridHTMLElement) will store a `gridstack: GridStack` value that can be retrieve later
   * const grid = document.querySelector('.grid-stack').gridstack;
   */
  static init(options = {}, elOrString = ".grid-stack") {
    if (typeof document === "undefined")
      return null;
    const el2 = _GridStack.getGridElement(elOrString);
    if (!el2) {
      if (typeof elOrString === "string") {
        console.error('GridStack.initAll() no grid was found with selector "' + elOrString + '" - element missing or wrong selector ?\nNote: ".grid-stack" is required for proper CSS styling and drag/drop, and is the default selector.');
      } else {
        console.error("GridStack.init() no grid element was passed.");
      }
      return null;
    }
    if (!el2.gridstack) {
      el2.gridstack = new _GridStack(el2, Utils.cloneDeep(options));
    }
    return el2.gridstack;
  }
  /**
   * Will initialize a list of elements (given a selector) and return an array of grids.
   * @param options grid options (optional)
   * @param selector elements selector to convert to grids (default to '.grid-stack' class selector)
   *
   * @example
   * const grids = GridStack.initAll();
   * grids.forEach(...)
   */
  static initAll(options = {}, selector = ".grid-stack") {
    const grids = [];
    if (typeof document === "undefined")
      return grids;
    _GridStack.getGridElements(selector).forEach((el2) => {
      if (!el2.gridstack) {
        el2.gridstack = new _GridStack(el2, Utils.cloneDeep(options));
      }
      grids.push(el2.gridstack);
    });
    if (grids.length === 0) {
      console.error('GridStack.initAll() no grid was found with selector "' + selector + '" - element missing or wrong selector ?\nNote: ".grid-stack" is required for proper CSS styling and drag/drop, and is the default selector.');
    }
    return grids;
  }
  /**
   * call to create a grid with the given options, including loading any children from JSON structure. This will call GridStack.init(), then
   * grid.load() on any passed children (recursively). Great alternative to calling init() if you want entire grid to come from
   * JSON serialized data, including options.
   * @param parent HTML element parent to the grid
   * @param opt grids options used to initialize the grid, and list of children
   */
  static addGrid(parent, opt = {}) {
    if (!parent)
      return null;
    let el2 = parent;
    if (el2.gridstack) {
      const grid2 = el2.gridstack;
      if (opt)
        grid2.opts = { ...grid2.opts, ...opt };
      if (opt.children !== void 0)
        grid2.load(opt.children);
      return grid2;
    }
    const parentIsGrid = parent.classList.contains("grid-stack");
    if (!parentIsGrid || _GridStack.addRemoveCB) {
      if (_GridStack.addRemoveCB) {
        el2 = _GridStack.addRemoveCB(parent, opt, true, true);
      } else {
        el2 = Utils.createDiv(["grid-stack", opt.class], parent);
      }
    }
    const grid = _GridStack.init(opt, el2);
    return grid;
  }
  /** call this method to register your engine instead of the default one.
   * See instead `GridStackOptions.engineClass` if you only need to
   * replace just one instance.
   */
  static registerEngine(engineClass) {
    _GridStack.engineClass = engineClass;
  }
  /**
   * @internal create placeholder DIV as needed
   * @returns the placeholder element for indicating drop zones during drag operations
   */
  get placeholder() {
    if (!this._placeholder) {
      this._placeholder = Utils.createDiv([this.opts.placeholderClass, gridDefaults.itemClass, this.opts.itemClass]);
      const placeholderChild = Utils.createDiv(["placeholder-content"], this._placeholder);
      if (this.opts.placeholderText) {
        placeholderChild.textContent = this.opts.placeholderText;
      }
    }
    return this._placeholder;
  }
  /**
   * Construct a grid item from the given element and options
   * @param el the HTML element tied to this grid after it's been initialized
   * @param opts grid options - public for classes to access, but use methods to modify!
   */
  constructor(el2, opts = {}) {
    this.el = el2;
    this.opts = opts;
    this.animationDelay = 300 + 10;
    this._gsEventHandler = {};
    this._extraDragRow = 0;
    this.dragTransform = { xScale: 1, yScale: 1, xOffset: 0, yOffset: 0 };
    el2.gridstack = this;
    this.opts = opts = opts || {};
    if (!el2.classList.contains("grid-stack")) {
      this.el.classList.add("grid-stack");
    }
    if (opts.row) {
      opts.minRow = opts.maxRow = opts.row;
      delete opts.row;
    }
    const rowAttr = Utils.toNumber(el2.getAttribute("gs-row"));
    if (opts.column === "auto") {
      delete opts.column;
    }
    if (opts.alwaysShowResizeHandle !== void 0) {
      opts._alwaysShowResizeHandle = opts.alwaysShowResizeHandle;
    }
    const resp = opts.columnOpts;
    if (resp) {
      const bk = resp.breakpoints;
      if (!resp.columnWidth && !bk?.length) {
        delete opts.columnOpts;
      } else {
        if (bk && bk.length > 1) {
          bk.sort((a, b) => (b.w || 0) - (a.w || 0));
          delete resp.columnWidth;
        } else {
          resp.columnMax = resp.columnMax || 12;
        }
      }
    }
    const defaults = {
      ...Utils.cloneDeep(gridDefaults),
      column: Utils.toNumber(el2.getAttribute("gs-column")) || gridDefaults.column,
      minRow: rowAttr ? rowAttr : Utils.toNumber(el2.getAttribute("gs-min-row")) || gridDefaults.minRow,
      maxRow: rowAttr ? rowAttr : Utils.toNumber(el2.getAttribute("gs-max-row")) || gridDefaults.maxRow,
      staticGrid: Utils.toBool(el2.getAttribute("gs-static")) || gridDefaults.staticGrid,
      sizeToContent: Utils.toBool(el2.getAttribute("gs-size-to-content")) || void 0,
      draggable: {
        handle: (opts.handleClass ? "." + opts.handleClass : opts.handle ? opts.handle : "") || gridDefaults.draggable.handle
      },
      removableOptions: {
        accept: opts.itemClass || gridDefaults.removableOptions.accept,
        decline: gridDefaults.removableOptions.decline
      }
    };
    if (el2.getAttribute("gs-animate")) {
      defaults.animate = Utils.toBool(el2.getAttribute("gs-animate"));
    }
    opts = Utils.defaults(opts, defaults);
    this._initMargin();
    this.checkDynamicColumn();
    this._updateColumnVar(opts);
    if (opts.rtl === "auto") {
      opts.rtl = el2.style.direction === "rtl";
    }
    if (opts.rtl) {
      this.el.classList.add("grid-stack-rtl");
    }
    const parentGridItem = this.el.closest("." + gridDefaults.itemClass);
    const parentNode = parentGridItem?.gridstackNode;
    if (parentNode) {
      parentNode.subGrid = this;
      this.parentGridNode = parentNode;
      this.el.classList.add("grid-stack-nested");
      parentNode.el.classList.add("grid-stack-sub-grid");
    }
    this._isAutoCellHeight = opts.cellHeight === "auto";
    if (this._isAutoCellHeight || opts.cellHeight === "initial") {
      this.cellHeight(void 0);
    } else {
      if (typeof opts.cellHeight == "number" && opts.cellHeightUnit && opts.cellHeightUnit !== gridDefaults.cellHeightUnit) {
        opts.cellHeight = opts.cellHeight + opts.cellHeightUnit;
        delete opts.cellHeightUnit;
      }
      const val = opts.cellHeight;
      delete opts.cellHeight;
      this.cellHeight(val);
    }
    if (opts.alwaysShowResizeHandle === "mobile") {
      opts.alwaysShowResizeHandle = isTouch;
    }
    this._setStaticClass();
    const engineClass = opts.engineClass || _GridStack.engineClass || GridStackEngine;
    this.engine = new engineClass({
      column: this.getColumn(),
      float: opts.float,
      maxRow: opts.maxRow,
      onChange: (cbNodes) => {
        cbNodes.forEach((n) => {
          const el3 = n.el;
          if (!el3)
            return;
          if (n._removeDOM) {
            if (el3)
              el3.remove();
            delete n._removeDOM;
          } else {
            this._writePosAttr(el3, n);
          }
        });
        this._updateContainerHeight();
      }
    });
    if (opts.auto) {
      this.batchUpdate();
      this.engine._loading = true;
      this.getGridItems().forEach((el3) => this._prepareElement(el3));
      delete this.engine._loading;
      this.batchUpdate(false);
    }
    if (opts.children) {
      const children = opts.children;
      delete opts.children;
      if (children.length)
        this.load(children);
    }
    this.setAnimation();
    if (opts.subGridDynamic && !DDManager.pauseDrag)
      DDManager.pauseDrag = true;
    if (opts.draggable?.pause !== void 0)
      DDManager.pauseDrag = opts.draggable.pause;
    this._setupRemoveDrop();
    this._setupAcceptWidget();
    this._updateResizeEvent();
  }
  _updateColumnVar(opts = this.opts) {
    this.el.classList.add("gs-" + opts.column);
    if (typeof opts.column === "number") {
      this.el.style.setProperty("--gs-column-width", `${100 / opts.column}%`);
      this.el.style.setProperty("--gs-columns", String(opts.column));
    }
  }
  /**
   * add a new widget and returns it.
   *
   * Widget will be always placed even if result height is more than actual grid height.
   * You need to use `willItFit()` before calling addWidget for additional check.
   * See also `makeWidget(el)` for DOM element.
   *
   * @example
   * const grid = GridStack.init();
   * grid.addWidget({w: 3, content: 'hello'});
   *
   * @param w GridStackWidget definition. used MakeWidget(el) if you have dom element instead.
   */
  addWidget(w) {
    if (!w)
      return;
    if (typeof w === "string") {
      console.error("V11: GridStack.addWidget() does not support string anymore. see #2736");
      return;
    }
    if (w.ELEMENT_NODE) {
      console.error("V11: GridStack.addWidget() does not support HTMLElement anymore. use makeWidget()");
      return this.makeWidget(w);
    }
    let el2;
    let node = w;
    node.grid = this;
    if (node.el) {
      el2 = node.el;
    } else if (_GridStack.addRemoveCB) {
      el2 = _GridStack.addRemoveCB(this.el, w, true, false);
    } else {
      el2 = this.createWidgetDivs(node);
    }
    if (!el2)
      return;
    node = el2.gridstackNode;
    if (node && el2.parentElement === this.el && this.engine.nodes.find((n) => n._id === node._id))
      return el2;
    const domAttr = this._readAttr(el2);
    Utils.defaults(w, domAttr);
    this.engine.prepareNode(w);
    this.el.appendChild(el2);
    this.makeWidget(el2, w);
    return el2;
  }
  /**
   * Create the default grid item divs and content (possibly lazy loaded) by using GridStack.renderCB().
   *
   * @param n GridStackNode definition containing widget configuration
   * @returns the created HTML element with proper grid item structure
   *
   * @example
   * const element = grid.createWidgetDivs({ w: 2, h: 1, content: 'Hello World' });
   */
  createWidgetDivs(n) {
    const el2 = Utils.createDiv(["grid-stack-item", this.opts.itemClass]);
    const cont = Utils.createDiv(["grid-stack-item-content"], el2);
    if (Utils.lazyLoad(n)) {
      if (!n.visibleObservable) {
        n.visibleObservable = new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting) {
            n.visibleObservable?.disconnect();
            delete n.visibleObservable;
            _GridStack.renderCB(cont, n);
            n.grid?.prepareDragDrop(n.el);
          }
        });
        window.setTimeout(() => n.visibleObservable?.observe(el2));
      }
    } else
      _GridStack.renderCB(cont, n);
    return el2;
  }
  /**
   * Convert an existing gridItem element into a sub-grid with the given (optional) options, else inherit them
   * from the parent's subGrid options.
   * @param el gridItem element to convert
   * @param ops (optional) sub-grid options, else default to node, then parent settings, else defaults
   * @param nodeToAdd (optional) node to add to the newly created sub grid (used when dragging over existing regular item)
   * @param saveContent if true (default) the html inside .grid-stack-content will be saved to child widget
   * @returns newly created grid
   */
  makeSubGrid(el2, ops, nodeToAdd, saveContent = true) {
    let node = el2.gridstackNode;
    if (!node) {
      node = this.makeWidget(el2).gridstackNode;
    }
    if (node.subGrid?.el)
      return node.subGrid;
    let subGridTemplate;
    let grid = this;
    while (grid && !subGridTemplate) {
      subGridTemplate = grid.opts?.subGridOpts;
      grid = grid.parentGridNode?.grid;
    }
    ops = Utils.cloneDeep({
      // by default sub-grid inherit from us | parent, other than id, children, etc...
      ...this.opts,
      id: void 0,
      children: void 0,
      column: "auto",
      columnOpts: void 0,
      layout: "list",
      subGridOpts: void 0,
      ...subGridTemplate || {},
      ...ops || node.subGridOpts || {}
    });
    node.subGridOpts = ops;
    let autoColumn = false;
    if (ops.column === "auto") {
      autoColumn = true;
      ops.column = Math.max(node.w || 1, nodeToAdd?.w || 1);
      delete ops.columnOpts;
    }
    let content = node.el.querySelector(".grid-stack-item-content");
    let newItem;
    let newItemOpt;
    if (saveContent) {
      this._removeDD(node.el);
      newItemOpt = { ...node, x: 0, y: 0 };
      Utils.removeInternalForSave(newItemOpt);
      delete newItemOpt.subGridOpts;
      if (node.content) {
        newItemOpt.content = node.content;
        delete node.content;
      }
      if (_GridStack.addRemoveCB) {
        newItem = _GridStack.addRemoveCB(this.el, newItemOpt, true, false) || void 0;
      } else {
        newItem = Utils.createDiv(["grid-stack-item"]);
        newItem.appendChild(content);
        content = Utils.createDiv(["grid-stack-item-content"], node.el);
      }
      this.prepareDragDrop(node.el);
    }
    if (nodeToAdd) {
      const w = autoColumn ? ops.column : node.w;
      const h = node.h + nodeToAdd.h;
      const style = node.el.style;
      style.transition = "none";
      this.update(node.el, { w, h });
      setTimeout(() => style.transition = "");
    }
    const subGrid = node.subGrid = _GridStack.addGrid(content, ops) || void 0;
    if (nodeToAdd?._moving)
      subGrid._isTemp = true;
    if (autoColumn)
      subGrid._autoColumn = true;
    if (saveContent) {
      subGrid.makeWidget(newItem, newItemOpt);
    }
    if (nodeToAdd) {
      if (nodeToAdd._moving) {
        window.setTimeout(() => Utils.simulateMouseEvent(nodeToAdd._event, "mouseenter", subGrid.el), 0);
      } else {
        subGrid.makeWidget(node.el, node);
      }
    }
    this.resizeToContentCheck(false, node);
    return subGrid;
  }
  /**
   * called when an item was converted into a nested grid to accommodate a dragged over item, but then item leaves - return back
   * to the original grid-item. Also called to remove empty sub-grids when last item is dragged out (since re-creating is simple)
   */
  removeAsSubGrid(nodeThatRemoved) {
    const pGrid = this.parentGridNode?.grid;
    if (!pGrid)
      return;
    pGrid.batchUpdate();
    pGrid.removeWidget(this.parentGridNode.el, true, true);
    this.engine.nodes.forEach((n) => {
      n.x = (n.x ?? 0) + (this.parentGridNode.x ?? 0);
      n.y = (n.y ?? 0) + (this.parentGridNode.y ?? 0);
      this._removeDD(n.el);
      n.el.remove();
      delete n.el.gridstackNode;
      pGrid.makeWidget(n.el, n);
    });
    pGrid.batchUpdate(false);
    if (this.parentGridNode)
      delete this.parentGridNode.subGrid;
    delete this.parentGridNode;
    if (nodeThatRemoved) {
      const origNode = nodeThatRemoved.el?.gridstackNode;
      if (origNode && origNode !== nodeThatRemoved)
        origNode._temporaryRemoved = true;
      window.setTimeout(() => {
        const dragEvent = DDManager.dragElement?.lastDrag || nodeThatRemoved._event;
        if (dragEvent)
          Utils.simulateMouseEvent(dragEvent, "mouseenter", pGrid.el);
      }, 0);
    }
  }
  /**
   * saves the current layout returning a list of widgets for serialization which might include any nested grids.
   * @param saveContent if true (default) the latest html inside .grid-stack-content will be saved to GridStackWidget.content field, else it will
   * be removed.
   * @param saveGridOpt if true (default false), save the grid options itself, so you can call the new GridStack.addGrid()
   * to recreate everything from scratch. GridStackOptions.children would then contain the widget list instead.
   * @param saveCB callback for each node -> widget, so application can insert additional data to be saved into the widget data structure.
   * @param column if provided, the grid will be saved for the given column size (IFF we have matching internal saved layout, or current layout).
   * Otherwise it will use the largest possible layout (say 12 even if rendering at 1 column) so we can restore to all layouts.
   * NOTE: if you want to save to currently display layout, pass this.getColumn() as column.
   * NOTE2: nested grids will ALWAYS save to the container size to be in sync with parent.
   * @returns list of widgets or full grid option, including .children list of widgets
   */
  save(saveContent = true, saveGridOpt = false, saveCB = _GridStack.saveCB, column) {
    const list = this.engine.save(saveContent, saveCB, column);
    list.forEach((n) => {
      if (saveContent && n.el && !n.subGrid && !saveCB) {
        const itemContent = n.el.querySelector(".grid-stack-item-content");
        n.content = itemContent?.innerHTML;
        if (!n.content)
          delete n.content;
      } else {
        if (!saveContent && !saveCB) {
          delete n.content;
        }
        if (n.subGrid?.el) {
          const column2 = n.w || n.subGrid.getColumn();
          const listOrOpt = n.subGrid.save(saveContent, saveGridOpt, saveCB, column2);
          n.subGridOpts = saveGridOpt ? listOrOpt : { children: listOrOpt };
          delete n.subGrid;
        }
      }
      delete n.el;
    });
    if (saveGridOpt) {
      const o = Utils.cloneDeep(this.opts);
      if (o.marginBottom === o.marginTop && o.marginRight === o.marginLeft && o.marginTop === o.marginRight) {
        o.margin = o.marginTop;
        delete o.marginTop;
        delete o.marginRight;
        delete o.marginBottom;
        delete o.marginLeft;
      }
      if (o.rtl === (this.el.style.direction === "rtl")) {
        o.rtl = "auto";
      }
      if (this._isAutoCellHeight) {
        o.cellHeight = "auto";
      }
      if (this._autoColumn) {
        o.column = "auto";
      }
      const origShow = o._alwaysShowResizeHandle;
      delete o._alwaysShowResizeHandle;
      if (origShow !== void 0) {
        o.alwaysShowResizeHandle = origShow;
      } else {
        delete o.alwaysShowResizeHandle;
      }
      Utils.removeInternalAndSame(o, gridDefaults);
      o.children = list;
      return o;
    }
    return list;
  }
  /**
   * Load widgets from a list. This will call update() on each (matching by id) or add/remove widgets that are not there.
   * Used to restore a grid layout for a saved layout list (see `save()`).
   *
   * @param items list of widgets definition to update/create
   * @param addRemove boolean (default true) or callback method can be passed to control if and how missing widgets can be added/removed, giving
   * the user control of insertion.
   * @returns the grid instance for chaining
   *
   * @example
   * // Basic usage with saved layout
   * const savedLayout = grid.save(); // Save current layout
   * // ... later restore it
   * grid.load(savedLayout);
   *
   * // Load with custom add/remove callback
   * grid.load(layout, (items, grid, add) => {
   *   if (add) {
   *     // Custom logic for adding new widgets
   *     items.forEach(item => {
   *       const el = document.createElement('div');
   *       el.innerHTML = item.content || '';
   *       grid.addWidget(el, item);
   *     });
   *   } else {
   *     // Custom logic for removing widgets
   *     items.forEach(item => grid.removeWidget(item.el));
   *   }
   * });
   *
   * // Load without adding/removing missing widgets
   * grid.load(layout, false);
   *
   * @see {@link http://gridstackjs.com/demo/serialization.html} for complete example
   */
  load(items, addRemove = _GridStack.addRemoveCB || true) {
    items.forEach((n) => {
      n.w = n.w || n.minW || 1;
      n.h = n.h || n.minH || 1;
    });
    items = Utils.sort(items);
    this.engine.skipCacheUpdate = this._ignoreLayoutsNodeChange = true;
    let maxColumn = 0;
    items.forEach((n) => {
      maxColumn = Math.max(maxColumn, (n.x || 0) + n.w);
    });
    if (maxColumn > this.engine.defaultColumn)
      this.engine.defaultColumn = maxColumn;
    const column = this.getColumn();
    if (maxColumn > column) {
      if (this.engine.nodes.length === 0 && this.responseLayout) {
        this.engine.nodes = items;
        this.engine.columnChanged(maxColumn, column, this.responseLayout);
        items = this.engine.nodes;
        this.engine.nodes = [];
        delete this.responseLayout;
      } else
        this.engine.cacheLayout(items, maxColumn, true);
    }
    const prevCB = _GridStack.addRemoveCB;
    if (typeof addRemove === "function")
      _GridStack.addRemoveCB = addRemove;
    const removed = [];
    this.batchUpdate();
    const blank = !this.engine.nodes.length;
    const noAnim = blank && this.opts.animate;
    if (noAnim)
      this.setAnimation(false);
    if (!blank && addRemove) {
      const copyNodes = [...this.engine.nodes];
      copyNodes.forEach((n) => {
        if (!n.id)
          return;
        const item = Utils.find(items, n.id);
        if (!item) {
          if (_GridStack.addRemoveCB)
            _GridStack.addRemoveCB(this.el, n, false, false);
          removed.push(n);
          this.removeWidget(n.el, true, false);
        }
      });
    }
    this.engine._loading = true;
    const updateNodes = [];
    this.engine.nodes = this.engine.nodes.filter((n) => {
      if (n.id && Utils.find(items, n.id)) {
        updateNodes.push(n);
        return false;
      }
      return true;
    });
    items.forEach((w) => {
      const item = w.id ? Utils.find(updateNodes, w.id) : void 0;
      if (item) {
        if (Utils.shouldSizeToContent(item))
          w.h = item.h;
        this.engine.nodeBoundFix(w);
        if (w.autoPosition || w.x === void 0 || w.y === void 0) {
          w.w = w.w || item.w;
          w.h = w.h || item.h;
          this.engine.findEmptyPosition(w);
        }
        this.engine.nodes.push(item);
        if (Utils.samePos(item, w) && this.engine.nodes.length > 1) {
          this.moveNode(item, { ...w, forceCollide: true });
          Utils.copyPos(w, item);
        }
        this.update(item.el, w);
        if (w.subGridOpts?.children) {
          const sub = item.el.querySelector(".grid-stack");
          if (sub && sub.gridstack) {
            sub.gridstack.load(w.subGridOpts.children);
          }
        }
      } else if (addRemove) {
        this.addWidget(w);
      }
    });
    delete this.engine._loading;
    this.engine.removedNodes = removed;
    this.batchUpdate(false);
    delete this._ignoreLayoutsNodeChange;
    delete this.engine.skipCacheUpdate;
    prevCB ? _GridStack.addRemoveCB = prevCB : delete _GridStack.addRemoveCB;
    if (noAnim)
      this.setAnimation(true, true);
    return this;
  }
  /**
   * use before calling a bunch of `addWidget()` to prevent un-necessary relayouts in between (more efficient)
   * and get a single event callback. You will see no changes until `batchUpdate(false)` is called.
   */
  batchUpdate(flag = true) {
    this.engine.batchUpdate(flag);
    if (!flag) {
      this._updateContainerHeight();
      this._triggerRemoveEvent();
      this._triggerAddEvent();
      this._triggerChangeEvent();
    }
    return this;
  }
  /**
   * Gets the current cell height in pixels. This takes into account the unit type and converts to pixels if necessary.
   *
   * @param forcePixel if true, forces conversion to pixels even when cellHeight is specified in other units
   * @returns the cell height in pixels
   *
   * @example
   * const height = grid.getCellHeight();
   * console.log('Cell height:', height, 'px');
   *
   * // Force pixel conversion
   * const pixelHeight = grid.getCellHeight(true);
   */
  getCellHeight(forcePixel = false) {
    if (this.opts.cellHeight && this.opts.cellHeight !== "auto" && (!forcePixel || !this.opts.cellHeightUnit || this.opts.cellHeightUnit === "px")) {
      return this.opts.cellHeight;
    }
    if (this.opts.cellHeightUnit === "rem") {
      return this.opts.cellHeight * parseFloat(getComputedStyle(document.documentElement).fontSize);
    }
    if (this.opts.cellHeightUnit === "em") {
      return this.opts.cellHeight * parseFloat(getComputedStyle(this.el).fontSize);
    }
    if (this.opts.cellHeightUnit === "cm") {
      return this.opts.cellHeight * (96 / 2.54);
    }
    if (this.opts.cellHeightUnit === "mm") {
      return this.opts.cellHeight * (96 / 2.54) / 10;
    }
    const el2 = this.el.querySelector("." + this.opts.itemClass);
    if (el2) {
      const h = Utils.toNumber(el2.getAttribute("gs-h")) || 1;
      return Math.round(el2.offsetHeight / h);
    }
    const rows = parseInt(this.el.getAttribute("gs-current-row") || "0");
    return rows ? Math.round(this.el.getBoundingClientRect().height / rows) : this.opts.cellHeight;
  }
  /**
   * Update current cell height - see `GridStackOptions.cellHeight` for format by updating eh Browser CSS variable.
   *
   * @param val the cell height. Options:
   *   - `undefined`: cells content will be made square (match width minus margin)
   *   - `0`: the CSS will be generated by the application instead
   *   - number: height in pixels
   *   - string: height with units (e.g., '70px', '5rem', '2em')
   * @returns the grid instance for chaining
   *
   * @example
   * grid.cellHeight(100);     // 100px height
   * grid.cellHeight('70px');  // explicit pixel height
   * grid.cellHeight('5rem');  // relative to root font size
   * grid.cellHeight(grid.cellWidth() * 1.2); // aspect ratio
   * grid.cellHeight('auto');  // auto-size based on content
   */
  cellHeight(val) {
    if (val !== void 0) {
      if (this._isAutoCellHeight !== (val === "auto")) {
        this._isAutoCellHeight = val === "auto";
        this._updateResizeEvent();
      }
    }
    if (val === "initial" || val === "auto") {
      val = void 0;
    }
    if (val === void 0) {
      const marginDiff = -this.opts.marginRight - this.opts.marginLeft + this.opts.marginTop + this.opts.marginBottom;
      val = this.cellWidth() + marginDiff;
    }
    const data = Utils.parseHeight(val);
    if (this.opts.cellHeightUnit === data.unit && this.opts.cellHeight === data.h) {
      return this;
    }
    this.opts.cellHeightUnit = data.unit;
    this.opts.cellHeight = data.h;
    this.el.style.setProperty("--gs-cell-height", `${this.opts.cellHeight}${this.opts.cellHeightUnit}`);
    this._updateContainerHeight();
    this.resizeToContentCheck();
    return this;
  }
  /** Gets current cell width. */
  /**
   * Gets the current cell width in pixels. This is calculated based on the grid container width divided by the number of columns.
   *
   * @returns the cell width in pixels
   *
   * @example
   * const width = grid.cellWidth();
   * console.log('Cell width:', width, 'px');
   *
   * // Use cell width to calculate widget dimensions
   * const widgetWidth = width * 3; // For a 3-column wide widget
   */
  cellWidth() {
    return this._widthOrContainer() / this.getColumn();
  }
  /** return our expected width (or parent) , and optionally of window for dynamic column check */
  _widthOrContainer(forBreakpoint = false) {
    return forBreakpoint && this.opts.columnOpts?.breakpointForWindow ? window.innerWidth : this.el.clientWidth || this.el.parentElement.clientWidth || window.innerWidth;
  }
  /** checks for dynamic column count for our current size, returning true if changed */
  checkDynamicColumn() {
    const resp = this.opts.columnOpts;
    if (!resp || !resp.columnWidth && !resp.breakpoints?.length)
      return false;
    const column = this.getColumn();
    let newColumn = column;
    const w = this._widthOrContainer(true);
    if (resp.columnWidth) {
      newColumn = Math.min(Math.round(w / resp.columnWidth) || 1, resp.columnMax);
    } else {
      newColumn = resp.columnMax;
      let i = 0;
      while (i < resp.breakpoints.length && w <= resp.breakpoints[i].w) {
        newColumn = resp.breakpoints[i++].c || column;
      }
    }
    if (newColumn !== column) {
      const bk = resp.breakpoints?.find((b) => b.c === newColumn);
      this.column(newColumn, bk?.layout || resp.layout);
      return true;
    }
    return false;
  }
  /**
   * Re-layout grid items to reclaim any empty space. This is useful after removing widgets
   * or when you want to optimize the layout.
   *
   * @param layout layout type. Options:
   *   - 'compact' (default): might re-order items to fill any empty space
   *   - 'list': keep the widget left->right order the same, even if that means leaving an empty slot if things don't fit
   * @param doSort re-sort items first based on x,y position. Set to false to do your own sorting ahead (default: true)
   * @returns the grid instance for chaining
   *
   * @example
   * // Compact layout after removing widgets
   * grid.removeWidget('.widget-to-remove');
   * grid.compact();
   *
   * // Use list layout (preserve order)
   * grid.compact('list');
   *
   * // Compact without sorting first
   * grid.compact('compact', false);
   */
  compact(layout = "compact", doSort = true) {
    this.engine.compact(layout, doSort);
    this._triggerChangeEvent();
    return this;
  }
  /**
   * Set the number of columns in the grid. Will update existing widgets to conform to new number of columns,
   * as well as cache the original layout so you can revert back to previous positions without loss.
   *
   * Requires `gridstack-extra.css` or `gridstack-extra.min.css` for [2-11] columns,
   * else you will need to generate correct CSS.
   * See: https://github.com/gridstack/gridstack.js#change-grid-columns
   *
   * @param column Integer > 0 (default 12)
   * @param layout specify the type of re-layout that will happen. Options:
   *   - 'moveScale' (default): scale widget positions and sizes
   *   - 'move': keep widget sizes, only move positions
   *   - 'scale': keep widget positions, only scale sizes
   *   - 'none': don't change widget positions or sizes
   *   Note: items will never be outside of the current column boundaries.
   *   Ignored for `column=1` as we always want to vertically stack.
   * @returns the grid instance for chaining
   *
   * @example
   * // Change to 6 columns with default scaling
   * grid.column(6);
   *
   * // Change to 4 columns, only move positions
   * grid.column(4, 'move');
   *
   * // Single column layout (vertical stack)
   * grid.column(1);
   */
  column(column, layout = "moveScale") {
    if (!column || column < 1 || this.opts.column === column)
      return this;
    const oldColumn = this.getColumn();
    this.opts.column = column;
    if (!this.engine) {
      this.responseLayout = layout;
      return this;
    }
    this.engine.column = column;
    this.el.classList.remove("gs-" + oldColumn);
    this._updateColumnVar();
    this.engine.columnChanged(oldColumn, column, layout);
    if (this._isAutoCellHeight)
      this.cellHeight();
    this.resizeToContentCheck(true);
    this._ignoreLayoutsNodeChange = true;
    this._triggerChangeEvent();
    delete this._ignoreLayoutsNodeChange;
    return this;
  }
  /**
   * Get the number of columns in the grid (default 12).
   *
   * @returns the current number of columns in the grid
   *
   * @example
   * const columnCount = grid.getColumn(); // returns 12 by default
   */
  getColumn() {
    return this.opts.column;
  }
  /**
   * Returns an array of grid HTML elements (no placeholder) - used to iterate through our children in DOM order.
   * This method excludes placeholder elements and returns only actual grid items.
   *
   * @returns array of GridItemHTMLElement instances representing all grid items
   *
   * @example
   * const items = grid.getGridItems();
   * items.forEach(item => {
   *   console.log('Item ID:', item.gridstackNode.id);
   * });
   */
  getGridItems() {
    return Array.from(this.el.children).filter((el2) => el2.matches("." + this.opts.itemClass) && !el2.matches("." + this.opts.placeholderClass));
  }
  /**
   * Returns true if change callbacks should be ignored due to column change, sizeToContent, loading, etc.
   * This is useful for callers who want to implement dirty flag functionality.
   *
   * @returns true if change callbacks are currently being ignored
   *
   * @example
   * if (!grid.isIgnoreChangeCB()) {
   *   // Process the change event
   *   console.log('Grid layout changed');
   * }
   */
  isIgnoreChangeCB() {
    return !!this._ignoreLayoutsNodeChange;
  }
  /**
   * Destroys a grid instance. DO NOT CALL any methods or access any vars after this as it will free up members.
   * @param removeDOM if `false` grid and items HTML elements will not be removed from the DOM (Optional. Default `true`).
   */
  destroy(removeDOM = true) {
    if (!this.el)
      return this;
    this.offAll();
    this._updateResizeEvent(true);
    this.setStatic(true, false);
    this.setAnimation(false);
    if (!removeDOM) {
      this.removeAll(removeDOM);
      this.el.removeAttribute("gs-current-row");
    } else {
      this.el.parentNode.removeChild(this.el);
    }
    if (this.parentGridNode)
      delete this.parentGridNode.subGrid;
    delete this.parentGridNode;
    delete this.opts;
    delete this._placeholder?.gridstackNode;
    delete this._placeholder;
    delete this.engine;
    delete this.el.gridstack;
    delete this.el;
    return this;
  }
  /**
   * Enable/disable floating widgets (default: `false`). When enabled, widgets can float up to fill empty spaces.
   * See [example](http://gridstackjs.com/demo/float.html)
   *
   * @param val true to enable floating, false to disable
   * @returns the grid instance for chaining
   *
   * @example
   * grid.float(true);  // Enable floating
   * grid.float(false); // Disable floating (default)
   */
  float(val) {
    if (this.opts.float !== val) {
      this.opts.float = this.engine.float = val;
      this._triggerChangeEvent();
    }
    return this;
  }
  /**
   * Get the current float mode setting.
   *
   * @returns true if floating is enabled, false otherwise
   *
   * @example
   * const isFloating = grid.getFloat();
   * console.log('Floating enabled:', isFloating);
   */
  getFloat() {
    return this.engine.float;
  }
  /**
   * Get the position of the cell under a pixel on screen.
   * @param position the position of the pixel to resolve in
   * absolute coordinates, as an object with top and left properties
   * @param useDocRelative if true, value will be based on document position vs parent position (Optional. Default false).
   * Useful when grid is within `position: relative` element
   *
   * Returns an object with properties `x` and `y` i.e. the column and row in the grid.
   */
  getCellFromPixel(position, useDocRelative = false) {
    const box = this.el.getBoundingClientRect();
    let containerPos;
    if (useDocRelative) {
      containerPos = { top: box.top + document.documentElement.scrollTop, left: box.left };
    } else {
      containerPos = { top: this.el.offsetTop, left: this.el.offsetLeft };
    }
    const relativeLeft = position.left - containerPos.left;
    const relativeTop = position.top - containerPos.top;
    const columnWidth = box.width / this.getColumn();
    const rowHeight = box.height / parseInt(this.el.getAttribute("gs-current-row") || "0");
    return { x: Math.floor(relativeLeft / columnWidth), y: Math.floor(relativeTop / rowHeight) };
  }
  /**
   * Returns the current number of rows, which will be at least `minRow` if set.
   * The row count is based on the highest positioned widget in the grid.
   *
   * @returns the current number of rows in the grid
   *
   * @example
   * const rowCount = grid.getRow();
   * console.log('Grid has', rowCount, 'rows');
   */
  getRow() {
    return Math.max(this.engine.getRow(), this.opts.minRow || 0);
  }
  /**
   * Checks if the specified rectangular area is empty (no widgets occupy any part of it).
   *
   * @param x the x coordinate (column) of the area to check
   * @param y the y coordinate (row) of the area to check
   * @param w the width in columns of the area to check
   * @param h the height in rows of the area to check
   * @returns true if the area is completely empty, false if any widget overlaps
   *
   * @example
   * // Check if a 2x2 area at position (1,1) is empty
   * if (grid.isAreaEmpty(1, 1, 2, 2)) {
   *   console.log('Area is available for placement');
   * }
   */
  isAreaEmpty(x, y, w, h) {
    return this.engine.isAreaEmpty(x, y, w, h);
  }
  /**
   * If you add elements to your grid by hand (or have some framework creating DOM), you have to tell gridstack afterwards to make them widgets.
   * If you want gridstack to add the elements for you, use `addWidget()` instead.
   * Makes the given element a widget and returns it.
   *
   * @param els widget or single selector to convert.
   * @param options widget definition to use instead of reading attributes or using default sizing values
   * @returns the converted GridItemHTMLElement
   *
   * @example
   * const grid = GridStack.init();
   *
   * // Create HTML content manually, possibly looking like:
   * // <div id="item-1" gs-x="0" gs-y="0" gs-w="3" gs-h="2"></div>
   * grid.el.innerHTML = '<div id="item-1" gs-w="3"></div><div id="item-2"></div>';
   *
   * // Convert existing elements to widgets
   * grid.makeWidget('#item-1'); // Uses gs-* attributes from DOM
   * grid.makeWidget('#item-2', {w: 2, h: 1, content: 'Hello World'});
   *
   * // Or pass DOM element directly
   * const element = document.getElementById('item-3');
   * grid.makeWidget(element, {x: 0, y: 1, w: 4, h: 2});
   */
  makeWidget(els, options) {
    const el2 = _GridStack.getElement(els);
    if (!el2 || el2.gridstackNode)
      return el2;
    if (!el2.parentElement)
      this.el.appendChild(el2);
    this._prepareElement(el2, true, options);
    const node = el2.gridstackNode;
    this._updateContainerHeight();
    if (node.subGridOpts) {
      this.makeSubGrid(el2, node.subGridOpts, void 0, false);
    }
    let resetIgnoreLayoutsNodeChange = false;
    if (this.opts.column === 1 && !this._ignoreLayoutsNodeChange) {
      resetIgnoreLayoutsNodeChange = this._ignoreLayoutsNodeChange = true;
    }
    this._triggerAddEvent();
    this._triggerChangeEvent();
    if (resetIgnoreLayoutsNodeChange)
      delete this._ignoreLayoutsNodeChange;
    return el2;
  }
  on(name, callback) {
    if (name.indexOf(" ") !== -1) {
      const names = name.split(" ");
      names.forEach((name2) => this.on(name2, callback));
      return this;
    }
    if (name === "change" || name === "added" || name === "removed" || name === "enable" || name === "disable") {
      const noData = name === "enable" || name === "disable";
      if (noData) {
        this._gsEventHandler[name] = (event2) => callback(event2);
      } else {
        this._gsEventHandler[name] = ((event2) => {
          if (event2.detail)
            callback(event2, event2.detail);
        });
      }
      this.el.addEventListener(name, this._gsEventHandler[name]);
    } else if (name === "drag" || name === "dragstart" || name === "dragstop" || name === "resizestart" || name === "resize" || name === "resizestop" || name === "dropped" || name === "resizecontent") {
      this._gsEventHandler[name] = callback;
    } else {
      console.error("GridStack.on(" + name + ") event not supported");
    }
    return this;
  }
  /**
   * unsubscribe from the 'on' event GridStackEvent
   * @param name of the event (see possible values) or list of names space separated
   */
  off(name) {
    if (name.indexOf(" ") !== -1) {
      const names = name.split(" ");
      names.forEach((name2) => this.off(name2));
      return this;
    }
    if (name === "change" || name === "added" || name === "removed" || name === "enable" || name === "disable") {
      if (this._gsEventHandler[name]) {
        this.el.removeEventListener(name, this._gsEventHandler[name]);
      }
    }
    delete this._gsEventHandler[name];
    return this;
  }
  /**
   * Remove all event handlers from the grid. This is useful for cleanup when destroying a grid.
   *
   * @returns the grid instance for chaining
   *
   * @example
   * grid.offAll(); // Remove all event listeners
   */
  offAll() {
    Object.keys(this._gsEventHandler).forEach((key) => this.off(key));
    return this;
  }
  /**
   * Removes widget from the grid.
   * @param el  widget or selector to modify
   * @param removeDOM if `false` DOM element won't be removed from the tree (Default? true).
   * @param triggerEvent if `false` (quiet mode) element will not be added to removed list and no 'removed' callbacks will be called (Default? true).
   */
  removeWidget(els, removeDOM = true, triggerEvent = true) {
    if (!els) {
      console.error("Error: GridStack.removeWidget(undefined) called");
      return this;
    }
    _GridStack.getElements(els).forEach((el2) => {
      if (el2.parentElement && el2.parentElement !== this.el)
        return;
      let node = el2.gridstackNode;
      if (!node) {
        node = this.engine.nodes.find((n) => el2 === n.el);
      }
      if (!node)
        return;
      if (removeDOM && _GridStack.addRemoveCB) {
        _GridStack.addRemoveCB(this.el, node, false, false);
      }
      delete el2.gridstackNode;
      this._removeDD(el2);
      this.engine.removeNode(node, removeDOM, triggerEvent);
      if (removeDOM && el2.parentElement) {
        el2.remove();
      }
    });
    if (triggerEvent) {
      this._triggerRemoveEvent();
      this._triggerChangeEvent();
    }
    return this;
  }
  /**
   * Removes all widgets from the grid.
   * @param removeDOM if `false` DOM elements won't be removed from the tree (Default? `true`).
   * @param triggerEvent if `false` (quiet mode) element will not be added to removed list and no 'removed' callbacks will be called (Default? true).
   */
  removeAll(removeDOM = true, triggerEvent = true) {
    this.engine.nodes.forEach((n) => {
      if (removeDOM && _GridStack.addRemoveCB) {
        _GridStack.addRemoveCB(this.el, n, false, false);
      }
      delete n.el.gridstackNode;
      if (!this.opts.staticGrid)
        this._removeDD(n.el);
    });
    this.engine.removeAll(removeDOM, triggerEvent);
    if (triggerEvent)
      this._triggerRemoveEvent();
    return this;
  }
  /**
   * Toggle the grid animation state.  Toggles the `grid-stack-animate` class.
   * @param doAnimate if true the grid will animate.
   * @param delay if true setting will be set on next event loop.
   */
  setAnimation(doAnimate = this.opts.animate, delay) {
    if (delay) {
      setTimeout(() => {
        if (this.opts)
          this.setAnimation(doAnimate);
      });
    } else if (doAnimate) {
      this.el.classList.add("grid-stack-animate");
    } else {
      this.el.classList.remove("grid-stack-animate");
    }
    this.opts.animate = doAnimate;
    return this;
  }
  /** @internal */
  hasAnimationCSS() {
    return this.el.classList.contains("grid-stack-animate");
  }
  /**
   * Toggle the grid static state, which permanently removes/add Drag&Drop support, unlike disable()/enable() that just turns it off/on.
   * Also toggle the grid-stack-static class.
   * @param val if true the grid become static.
   * @param updateClass true (default) if css class gets updated
   * @param recurse true (default) if sub-grids also get updated
   */
  setStatic(val, updateClass = true, recurse = true) {
    if (!!this.opts.staticGrid === val)
      return this;
    val ? this.opts.staticGrid = true : delete this.opts.staticGrid;
    this._setupRemoveDrop();
    this._setupAcceptWidget();
    this.engine.nodes.forEach((n) => {
      this.prepareDragDrop(n.el);
      if (n.subGrid && recurse)
        n.subGrid.setStatic(val, updateClass, recurse);
    });
    if (updateClass) {
      this._setStaticClass();
    }
    return this;
  }
  /**
   * Updates the passed in options on the grid (similar to update(widget) for for the grid options).
   * @param options PARTIAL grid options to update - only items specified will be updated.
   * NOTE: not all options updating are currently supported (lot of code, unlikely to change)
   */
  updateOptions(o) {
    const opts = this.opts;
    if (o === opts)
      return this;
    if (o.acceptWidgets !== void 0) {
      opts.acceptWidgets = o.acceptWidgets;
      this._setupAcceptWidget();
    }
    if (o.animate !== void 0)
      this.setAnimation(o.animate);
    if (o.cellHeight)
      this.cellHeight(o.cellHeight);
    if (o.class !== void 0 && o.class !== opts.class) {
      if (opts.class)
        this.el.classList.remove(opts.class);
      if (o.class)
        this.el.classList.add(o.class);
    }
    if (o.columnOpts) {
      const hadColumnOpts = !!this.opts.columnOpts;
      this.opts.columnOpts = o.columnOpts;
      if (hadColumnOpts !== !!this.opts.columnOpts)
        this._updateResizeEvent();
      this.checkDynamicColumn();
    } else if (o.columnOpts === null && this.opts.columnOpts) {
      delete this.opts.columnOpts;
      this._updateResizeEvent();
    } else if (typeof o.column === "number")
      this.column(o.column);
    if (o.margin !== void 0)
      this.margin(o.margin);
    if (o.staticGrid !== void 0)
      this.setStatic(o.staticGrid);
    if (o.disableDrag !== void 0 && !o.staticGrid)
      this.enableMove(!o.disableDrag);
    if (o.disableResize !== void 0 && !o.staticGrid)
      this.enableResize(!o.disableResize);
    if (o.float !== void 0)
      this.float(o.float);
    if (o.row !== void 0) {
      opts.minRow = opts.maxRow = this.engine.maxRow = opts.row = o.row;
      this._updateContainerHeight();
      if (this.engine.getRow() > o.row)
        this.compact();
    } else {
      if (o.minRow !== void 0) {
        opts.minRow = o.minRow;
        this._updateContainerHeight();
      }
      if (o.maxRow !== void 0) {
        opts.maxRow = this.engine.maxRow = o.maxRow;
        if (this.engine.getRow() > o.maxRow)
          this.compact();
      }
    }
    if (o.lazyLoad !== void 0)
      opts.lazyLoad = o.lazyLoad;
    if (o.children?.length)
      this.load(o.children);
    return this;
  }
  /**
   * Updates widget position/size and other info. This is used to change widget properties after creation.
   * Can update position, size, content, and other widget properties.
   *
   * Note: If you need to call this on all nodes, use load() instead which will update what changed.
   * Setting the same x,y for multiple items will be indeterministic and likely unwanted.
   *
   * @param els widget element(s) or selector to modify
   * @param opt new widget options (x,y,w,h, etc.). Only those set will be updated.
   * @returns the grid instance for chaining
   *
   * @example
   * // Update widget size and position
   * grid.update('.my-widget', { x: 2, y: 1, w: 3, h: 2 });
   *
   * // Update widget content
   * grid.update(widget, { content: '<p>New content</p>' });
   *
   * // Update multiple properties
   * grid.update('#my-widget', {
   *   w: 4,
   *   h: 3,
   *   noResize: true,
   *   locked: true
   * });
   */
  update(els, opt) {
    _GridStack.getElements(els).forEach((el2) => {
      const n = el2?.gridstackNode;
      if (!n)
        return;
      const w = { ...Utils.copyPos({}, n), ...Utils.cloneDeep(opt) };
      this.engine.nodeBoundFix(w);
      delete w.autoPosition;
      const keys = ["x", "y", "w", "h"];
      let m;
      const wRec = w;
      const nRec = n;
      if (keys.some((k) => wRec[k] !== void 0 && wRec[k] !== nRec[k])) {
        m = {};
        const mRec = m;
        keys.forEach((k) => {
          mRec[k] = wRec[k] !== void 0 ? wRec[k] : nRec[k];
          delete wRec[k];
        });
      }
      if (!m && (w.minW || w.minH || w.maxW || w.maxH)) {
        m = {};
      }
      if (w.content !== void 0) {
        const itemContent = el2.querySelector(".grid-stack-item-content");
        if (itemContent && itemContent.textContent !== w.content) {
          n.content = w.content;
          _GridStack.renderCB(itemContent, w);
          if (n.subGrid?.el) {
            itemContent.appendChild(n.subGrid.el);
            n.subGrid._updateContainerHeight();
          }
        }
        delete w.content;
      }
      let changed = false;
      let ddChanged = false;
      for (const key in wRec) {
        if (key[0] !== "_" && nRec[key] !== wRec[key]) {
          nRec[key] = wRec[key];
          changed = true;
          ddChanged = ddChanged || !this.opts.staticGrid && (key === "noResize" || key === "noMove" || key === "locked");
        }
      }
      Utils.sanitizeMinMax(n);
      if (m) {
        const widthChanged = m.w !== void 0 && m.w !== n.w;
        this.moveNode(n, m);
        if (widthChanged && n.subGrid) {
          n.subGrid.onResize(this.hasAnimationCSS() ? n.w : void 0);
        } else {
          this.resizeToContentCheck(widthChanged, n);
        }
        delete n._orig;
      }
      if (m || changed) {
        this._writeAttr(el2, n);
      }
      if (ddChanged) {
        this.prepareDragDrop(n.el);
      }
      if (_GridStack.updateCB)
        _GridStack.updateCB(n);
    });
    return this;
  }
  moveNode(n, m) {
    const wasUpdating = n._updating;
    if (!wasUpdating)
      this.engine.cleanNodes().beginUpdate(n);
    this.engine.moveNode(n, m);
    this._updateContainerHeight();
    if (!wasUpdating) {
      this._triggerChangeEvent();
      this.engine.endUpdate();
    }
  }
  /**
   * Updates widget height to match the content height to avoid vertical scrollbars or dead space.
   * This automatically adjusts the widget height based on its content size.
   *
   * Note: This assumes only 1 child under resizeToContentParent='.grid-stack-item-content'
   * (sized to gridItem minus padding) that represents the entire content size.
   *
   * @param el the grid item element to resize
   *
   * @example
   * // Resize a widget to fit its content
   * const widget = document.querySelector('.grid-stack-item');
   * grid.resizeToContent(widget);
   *
   * // This is commonly used with dynamic content:
   * widget.querySelector('.content').innerHTML = 'New longer content...';
   * grid.resizeToContent(widget);
   */
  resizeToContent(el2) {
    if (!el2)
      return;
    el2.classList.remove("size-to-content-max");
    if (!el2.clientHeight)
      return;
    const n = el2.gridstackNode;
    if (!n)
      return;
    const grid = n.grid;
    if (!grid || el2.parentElement !== grid.el)
      return;
    const cell = grid.getCellHeight(true);
    if (!cell)
      return;
    let height = n.h ? n.h * cell : el2.clientHeight;
    let item = null;
    if (n.resizeToContentParent)
      item = el2.querySelector(n.resizeToContentParent);
    if (!item)
      item = el2.querySelector(_GridStack.resizeToContentParent);
    if (!item)
      return;
    const padding = el2.clientHeight - item.clientHeight;
    const itemH = n.h ? n.h * cell - padding : item.clientHeight;
    let wantedH;
    if (n.subGrid) {
      wantedH = n.subGrid.getRow() * n.subGrid.getCellHeight(true);
      const subRec = n.subGrid.el.getBoundingClientRect();
      const parentRec = el2.getBoundingClientRect();
      wantedH += subRec.top - parentRec.top;
    } else if (n.subGridOpts?.children?.length) {
      return;
    } else {
      const child = item.firstElementChild;
      if (!child) {
        console.error(`Error: GridStack.resizeToContent() widget id:${n.id} '${_GridStack.resizeToContentParent}'.firstElementChild is null, make sure to have a div like container. Skipping sizing.`);
        return;
      }
      wantedH = child.getBoundingClientRect().height || itemH;
    }
    if (itemH === wantedH)
      return;
    height += wantedH - itemH;
    let h = Math.ceil(height / cell);
    const softMax = Number.isInteger(n.sizeToContent) ? n.sizeToContent : 0;
    if (softMax && h > softMax) {
      h = softMax;
      el2.classList.add("size-to-content-max");
    }
    if (n.minH && h < n.minH)
      h = n.minH;
    else if (n.maxH && h > n.maxH)
      h = n.maxH;
    if (h !== n.h) {
      grid._ignoreLayoutsNodeChange = true;
      grid.moveNode(n, { h });
      delete grid._ignoreLayoutsNodeChange;
    }
  }
  /** call the user resize (so they can do extra work) else our build in version */
  resizeToContentCBCheck(el2) {
    if (_GridStack.resizeToContentCB)
      _GridStack.resizeToContentCB(el2);
    else
      this.resizeToContent(el2);
  }
  /**
   * Rotate widgets by swapping their width and height. This is typically called when the user presses 'r' during dragging.
   * The rotation swaps the w/h dimensions and adjusts min/max constraints accordingly.
   *
   * @param els widget element(s) or selector to rotate
   * @param relative optional pixel coordinate relative to upper/left corner to rotate around (keeps that cell under cursor)
   * @returns the grid instance for chaining
   *
   * @example
   * // Rotate a specific widget
   * grid.rotate('.my-widget');
   *
   * // Rotate with relative positioning during drag
   * grid.rotate(widget, { left: 50, top: 30 });
   */
  rotate(els, relative) {
    _GridStack.getElements(els).forEach((el2) => {
      const n = el2.gridstackNode;
      if (!n || !Utils.canBeRotated(n))
        return;
      const rot = { w: n.h, h: n.w, minH: n.minW, minW: n.minH, maxH: n.maxW, maxW: n.maxH };
      if (relative) {
        const pivotX = relative.left > 0 ? Math.floor(relative.left / this.cellWidth()) : 0;
        const pivotY = relative.top > 0 ? Math.floor(relative.top / this.opts.cellHeight) : 0;
        rot.x = n.x + pivotX - (n.h - (pivotY + 1));
        rot.y = n.y + pivotY - pivotX;
      }
      const rotRec = rot;
      Object.keys(rotRec).forEach((k) => {
        if (rotRec[k] === void 0)
          delete rotRec[k];
      });
      const _orig = n._orig;
      this.update(el2, rot);
      n._orig = _orig;
    });
    return this;
  }
  /**
   * Updates the margins which will set all 4 sides at once - see `GridStackOptions.margin` for format options.
   * Supports CSS string format of 1, 2, or 4 values or a single number.
   *
   * @param value margin value - can be:
   *   - Single number: `10` (applies to all sides)
   *   - Two values: `'10px 20px'` (top/bottom, left/right)
   *   - Four values: `'10px 20px 5px 15px'` (top, right, bottom, left)
   * @returns the grid instance for chaining
   *
   * @example
   * grid.margin(10);           // 10px all sides
   * grid.margin('10px 20px');  // 10px top/bottom, 20px left/right
   * grid.margin('5px 10px 15px 20px'); // Different for each side
   */
  margin(value) {
    const isMultiValue = typeof value === "string" && value.split(" ").length > 1;
    if (!isMultiValue) {
      const data = Utils.parseHeight(value);
      if (this.opts.marginUnit === data.unit && this.opts.margin === data.h)
        return this;
    }
    this.opts.margin = value;
    this.opts.marginTop = this.opts.marginBottom = this.opts.marginLeft = this.opts.marginRight = void 0;
    this._initMargin();
    return this;
  }
  /**
   * Returns the current margin value as a number (undefined if the 4 sides don't match).
   * This only returns a number if all sides have the same margin value.
   *
   * @returns the margin value in pixels, or undefined if sides have different values
   *
   * @example
   * const margin = grid.getMargin();
   * if (margin !== undefined) {
   *   console.log('Uniform margin:', margin, 'px');
   * } else {
   *   console.log('Margins are different on different sides');
   * }
   */
  getMargin() {
    return this.opts.margin;
  }
  /**
   * Returns true if the height of the grid will be less than the vertical
   * constraint. Always returns true if grid doesn't have height constraint.
   * @param node contains x,y,w,h,auto-position options
   *
   * @example
   * if (grid.willItFit(newWidget)) {
   *   grid.addWidget(newWidget);
   * } else {
   *   alert('Not enough free space to place the widget');
   * }
   */
  willItFit(node) {
    return this.engine.willItFit(node);
  }
  /** @internal */
  _triggerChangeEvent() {
    if (this.engine.batchMode)
      return this;
    const elements = this.engine.getDirtyNodes(true);
    if (elements && elements.length) {
      if (!this._ignoreLayoutsNodeChange) {
        this.engine.layoutsNodesChange(elements);
      }
      this._triggerEvent("change", elements);
    }
    this.engine.saveInitial();
    this._sortDom();
    return this;
  }
  /** @internal Re-orders the HTML DOM nodes to match the visual layout for accessibility (Tab navigation) and printing (when not using CSS grids). */
  _sortDom() {
    let nodes = this.engine.nodes;
    nodes.forEach((n) => {
      if (n.subGrid)
        n.subGrid._sortDom();
    });
    if (nodes.length < 2)
      return this;
    this.engine.sortNodes();
    nodes = this.engine.nodes;
    const children = this.el.children;
    if (nodes.some((n, i) => n.el !== children[i])) {
      const moveBefore = this.el.moveBefore?.bind(this.el);
      nodes.forEach((n) => {
        if (n.el && n.el.parentElement === this.el) {
          if (moveBefore)
            moveBefore(n.el, null);
          else
            this.el.appendChild(n.el);
        }
      });
    }
    return this;
  }
  /** @internal */
  _triggerAddEvent() {
    if (this.engine.batchMode)
      return this;
    if (this.engine.addedNodes?.length) {
      if (!this._ignoreLayoutsNodeChange) {
        this.engine.layoutsNodesChange(this.engine.addedNodes);
      }
      this.engine.addedNodes.forEach((n) => {
        delete n._dirty;
      });
      const addedNodes = [...this.engine.addedNodes];
      this.engine.addedNodes = [];
      this._triggerEvent("added", addedNodes);
    }
    return this;
  }
  /** @internal */
  _triggerRemoveEvent() {
    if (this.engine.batchMode)
      return this;
    if (this.engine.removedNodes?.length) {
      const removedNodes = [...this.engine.removedNodes];
      this.engine.removedNodes = [];
      this._triggerEvent("removed", removedNodes);
    }
    return this;
  }
  /** @internal */
  _triggerEvent(type, data) {
    const event2 = data ? new CustomEvent(type, { bubbles: false, detail: data }) : new Event(type);
    let grid = this;
    while (grid.parentGridNode)
      grid = grid.parentGridNode.grid;
    grid.el.dispatchEvent(event2);
    return this;
  }
  /** @internal */
  _updateContainerHeight() {
    if (!this.engine || this.engine.batchMode)
      return this;
    const parent = this.parentGridNode;
    let row = this.getRow() + this._extraDragRow;
    const cellHeight = this.opts.cellHeight;
    const unit = this.opts.cellHeightUnit;
    if (!cellHeight)
      return this;
    if (!parent && !this.opts.minRow) {
      const cssMinHeight = Utils.parseHeight(getComputedStyle(this.el)["minHeight"]);
      if (cssMinHeight.h > 0 && cssMinHeight.unit === unit) {
        const minRow = Math.floor(cssMinHeight.h / cellHeight);
        if (row < minRow) {
          row = minRow;
        }
      }
    }
    this.el.setAttribute("gs-current-row", String(row));
    this.el.style.removeProperty("min-height");
    this.el.style.removeProperty("height");
    if (row) {
      this.el.style[parent ? "minHeight" : "height"] = row * cellHeight + unit;
    }
    if (parent && Utils.shouldSizeToContent(parent)) {
      parent.grid.resizeToContentCBCheck(parent.el);
    }
    return this;
  }
  /** @internal */
  _prepareElement(el2, triggerAddEvent = false, node) {
    node = node || this._readAttr(el2);
    el2.gridstackNode = node;
    node.el = el2;
    node.grid = this;
    node = this.engine.addNode(node, triggerAddEvent);
    this._writeAttr(el2, node);
    el2.classList.add(gridDefaults.itemClass, this.opts.itemClass);
    const sizeToContent = Utils.shouldSizeToContent(node);
    sizeToContent ? el2.classList.add("size-to-content") : el2.classList.remove("size-to-content");
    if (sizeToContent)
      this.resizeToContentCheck(false, node);
    if (!Utils.lazyLoad(node) || !node.visibleObservable) {
      this.prepareDragDrop(node.el);
    }
    return this;
  }
  /** @internal write position CSS vars and x,y,w,h attributes (not used for CSS but by users) back to element */
  _writePosAttr(el2, n) {
    if (!n._moving && !n._resizing || this._placeholder === el2) {
      const xProp = this.opts.rtl ? "right" : "left";
      const elStyle = el2.style;
      elStyle.top = n.y ? n.y === 1 ? `var(--gs-cell-height)` : `calc(${n.y} * var(--gs-cell-height))` : null;
      elStyle[xProp] = n.x ? n.x === 1 ? `var(--gs-column-width)` : `calc(${n.x} * var(--gs-column-width))` : null;
      elStyle.width = n.w > 1 ? `calc(${n.w} * var(--gs-column-width))` : null;
      elStyle.height = n.h > 1 ? `calc(${n.h} * var(--gs-cell-height))` : null;
    }
    el2.style.setProperty("--gs-x", String(n.x || 0));
    el2.style.setProperty("--gs-y", String(n.y || 0));
    el2.style.setProperty("--gs-w", String(n.w || 1));
    el2.style.setProperty("--gs-h", String(n.h || 1));
    el2.setAttribute("gs-x", String(n.x ?? 0));
    el2.setAttribute("gs-y", String(n.y ?? 0));
    n.w > 1 ? el2.setAttribute("gs-w", String(n.w)) : el2.removeAttribute("gs-w");
    n.h > 1 ? el2.setAttribute("gs-h", String(n.h)) : el2.removeAttribute("gs-h");
    return this;
  }
  /** @internal call to write any default attributes back to element */
  _writeAttr(el2, node) {
    if (!node)
      return this;
    this._writePosAttr(el2, node);
    const attrs = {
      // autoPosition: 'gs-auto-position', // no need to write out as already in node and doesn't affect CSS
      noResize: "gs-no-resize",
      noMove: "gs-no-move",
      locked: "gs-locked",
      id: "gs-id",
      sizeToContent: "gs-size-to-content"
    };
    const nodeRec = node;
    const attrsRec = attrs;
    for (const key in attrsRec) {
      if (nodeRec[key] !== void 0 && nodeRec[key] !== null && nodeRec[key] !== false) {
        el2.setAttribute(attrsRec[key], String(nodeRec[key]));
      } else {
        el2.removeAttribute(attrsRec[key]);
      }
    }
    const print = node.print;
    if (print) {
      if (print.pageBreak)
        el2.setAttribute("gs-page-break", String(print.pageBreak));
      else
        el2.removeAttribute("gs-page-break");
      if (print.hide)
        el2.classList.add("gs-print-hide");
      else
        el2.classList.remove("gs-print-hide");
      if (print.orientation)
        el2.setAttribute("gs-print-orientation", String(print.orientation));
      else
        el2.removeAttribute("gs-print-orientation");
      if (print.breakInside)
        el2.setAttribute("gs-break-inside", String(print.breakInside));
      else
        el2.removeAttribute("gs-break-inside");
    } else {
      el2.removeAttribute("gs-page-break");
      el2.classList.remove("gs-print-hide");
      el2.removeAttribute("gs-print-orientation");
      el2.removeAttribute("gs-break-inside");
    }
    return this;
  }
  /** @internal call to read any default attributes from element */
  _readAttr(el2, clearDefaultAttr = true) {
    const n = {};
    n.x = Utils.toNumber(el2.getAttribute("gs-x"));
    n.y = Utils.toNumber(el2.getAttribute("gs-y"));
    n.w = Utils.toNumber(el2.getAttribute("gs-w"));
    n.h = Utils.toNumber(el2.getAttribute("gs-h"));
    n.autoPosition = Utils.toBool(el2.getAttribute("gs-auto-position"));
    n.noResize = Utils.toBool(el2.getAttribute("gs-no-resize"));
    n.noMove = Utils.toBool(el2.getAttribute("gs-no-move"));
    n.locked = Utils.toBool(el2.getAttribute("gs-locked"));
    let pageBreak = el2.getAttribute("gs-page-break");
    let hide = el2.classList.contains("gs-print-hide");
    let orientation = el2.getAttribute("gs-print-orientation");
    let breakInside = el2.getAttribute("gs-break-inside");
    if (pageBreak || hide || orientation || breakInside) {
      n.print = {};
      if (pageBreak)
        n.print.pageBreak = Utils.toBool(pageBreak);
      if (hide)
        n.print.hide = true;
      if (orientation)
        n.print.orientation = orientation;
      if (breakInside)
        n.print.breakInside = Utils.toBool(breakInside);
    }
    const attr = el2.getAttribute("gs-size-to-content");
    if (attr) {
      if (attr === "true" || attr === "false")
        n.sizeToContent = Utils.toBool(attr);
      else
        n.sizeToContent = parseInt(attr, 10);
    }
    n.id = el2.getAttribute("gs-id") ?? void 0;
    n.maxW = Utils.toNumber(el2.getAttribute("gs-max-w"));
    n.minW = Utils.toNumber(el2.getAttribute("gs-min-w"));
    n.maxH = Utils.toNumber(el2.getAttribute("gs-max-h"));
    n.minH = Utils.toNumber(el2.getAttribute("gs-min-h"));
    if (clearDefaultAttr) {
      if (n.w === 1)
        el2.removeAttribute("gs-w");
      if (n.h === 1)
        el2.removeAttribute("gs-h");
      if (n.maxW)
        el2.removeAttribute("gs-max-w");
      if (n.minW)
        el2.removeAttribute("gs-min-w");
      if (n.maxH)
        el2.removeAttribute("gs-max-h");
      if (n.minH)
        el2.removeAttribute("gs-min-h");
    }
    const nRec = n;
    for (const key in nRec) {
      if (!n.hasOwnProperty(key))
        continue;
      if (!nRec[key] && nRec[key] !== 0 && key !== "sizeToContent") {
        delete nRec[key];
      }
    }
    return n;
  }
  /** @internal */
  _setStaticClass() {
    const classes = ["grid-stack-static"];
    if (this.opts.staticGrid) {
      this.el.classList.add(...classes);
      this.el.setAttribute("gs-static", "true");
    } else {
      this.el.classList.remove(...classes);
      this.el.removeAttribute("gs-static");
    }
    return this;
  }
  /**
   * called when we are being resized - check if the one Column Mode needs to be turned on/off
   * and remember the prev columns we used, or get our count from parent, as well as check for cellHeight==='auto' (square)
   * or `sizeToContent` gridItem options.
   */
  onResize(clientWidth = this.el?.clientWidth) {
    if (!clientWidth)
      return this;
    if (this.prevWidth === clientWidth)
      return this;
    this.prevWidth = clientWidth;
    this.batchUpdate();
    let columnChanged = false;
    if (this._autoColumn && this.parentGridNode) {
      if (this.opts.column !== this.parentGridNode.w) {
        this.column(this.parentGridNode.w, this.opts.layout || "list");
        columnChanged = true;
      }
    } else {
      columnChanged = this.checkDynamicColumn();
    }
    if (this._isAutoCellHeight)
      this.cellHeight();
    this.engine.nodes.forEach((n) => {
      if (n.subGrid)
        n.subGrid.onResize();
    });
    if (!this._skipInitialResize)
      this.resizeToContentCheck(columnChanged);
    delete this._skipInitialResize;
    this.batchUpdate(false);
    return this;
  }
  /** resizes content for given node (or all) if shouldSizeToContent() is true */
  resizeToContentCheck(delay = false, n) {
    if (!this.engine)
      return;
    if (delay && this.hasAnimationCSS()) {
      setTimeout(() => this.resizeToContentCheck(false, n), this.animationDelay);
      return;
    }
    if (n) {
      if (Utils.shouldSizeToContent(n))
        this.resizeToContentCBCheck(n.el);
    } else if (this.engine.nodes.some((n2) => Utils.shouldSizeToContent(n2))) {
      const nodes = [...this.engine.nodes];
      this.batchUpdate();
      nodes.forEach((n2) => {
        if (Utils.shouldSizeToContent(n2))
          this.resizeToContentCBCheck(n2.el);
      });
      this._ignoreLayoutsNodeChange = true;
      this.batchUpdate(false);
      this._ignoreLayoutsNodeChange = false;
    }
    const rcHandler = this._gsEventHandler["resizecontent"];
    if (rcHandler)
      rcHandler(new Event("resizecontent"), n ? [n] : this.engine.nodes);
  }
  /** add or remove the grid element size event handler */
  _updateResizeEvent(forceRemove = false) {
    const trackSize = !this.parentGridNode && (this._isAutoCellHeight || this.opts.sizeToContent || this.opts.columnOpts || this.engine.nodes.find((n) => n.sizeToContent));
    if (!forceRemove && trackSize && !this.resizeObserver) {
      this._sizeThrottle = Utils.throttle(() => this.onResize(), this.opts.cellHeightThrottle);
      this.resizeObserver = new ResizeObserver(() => this._sizeThrottle());
      this.resizeObserver.observe(this.el);
      this._skipInitialResize = true;
    } else if ((forceRemove || !trackSize) && this.resizeObserver) {
      this.resizeObserver.disconnect();
      delete this.resizeObserver;
      delete this._sizeThrottle;
    }
    return this;
  }
  /** @internal convert a potential selector into actual element */
  static getElement(els = ".grid-stack-item") {
    return Utils.getElement(els);
  }
  /** @internal */
  static getElements(els = ".grid-stack-item") {
    return Utils.getElements(els);
  }
  /** @internal */
  static getGridElement(els) {
    return _GridStack.getElement(els);
  }
  /** @internal */
  static getGridElements(els) {
    return Utils.getElements(els);
  }
  /** @internal initialize margin top/bottom/left/right and units */
  _initMargin() {
    let data = { h: 0, unit: "px" };
    let margin = 0;
    let margins = [];
    if (typeof this.opts.margin === "string") {
      margins = this.opts.margin.split(" ");
    }
    if (margins.length === 2) {
      this.opts.marginTop = this.opts.marginBottom = margins[0];
      this.opts.marginLeft = this.opts.marginRight = margins[1];
    } else if (margins.length === 4) {
      this.opts.marginTop = margins[0];
      this.opts.marginRight = margins[1];
      this.opts.marginBottom = margins[2];
      this.opts.marginLeft = margins[3];
    } else {
      data = Utils.parseHeight(this.opts.margin);
      this.opts.marginUnit = data.unit;
      margin = this.opts.margin = data.h;
    }
    const keys = ["marginTop", "marginRight", "marginBottom", "marginLeft"];
    const optsRec = this.opts;
    keys.forEach((k) => {
      if (optsRec[k] === void 0) {
        optsRec[k] = margin;
      } else {
        data = Utils.parseHeight(optsRec[k]);
        optsRec[k] = data.h;
        delete this.opts.margin;
      }
    });
    this.opts.marginUnit = data.unit;
    if (this.opts.marginTop === this.opts.marginBottom && this.opts.marginLeft === this.opts.marginRight && this.opts.marginTop === this.opts.marginRight) {
      this.opts.margin = this.opts.marginTop;
    }
    const style = this.el.style;
    style.setProperty("--gs-item-margin-top", `${this.opts.marginTop}${this.opts.marginUnit}`);
    style.setProperty("--gs-item-margin-bottom", `${this.opts.marginBottom}${this.opts.marginUnit}`);
    style.setProperty("--gs-item-margin-right", `${this.opts.marginRight}${this.opts.marginUnit}`);
    style.setProperty("--gs-item-margin-left", `${this.opts.marginLeft}${this.opts.marginUnit}`);
    return this;
  }
  /* ===========================================================================================
   * drag&drop methods that used to be stubbed out and implemented in dd-gridstack.ts
   * but caused loading issues in prod - see https://github.com/gridstack/gridstack.js/issues/2039
   * ===========================================================================================
   */
  /**
   * Get the global drag & drop implementation instance.
   * This provides access to the underlying drag & drop functionality.
   *
   * @returns the DDGridStack instance used for drag & drop operations
   *
   * @example
   * const dd = GridStack.getDD();
   * // Access drag & drop functionality
   */
  static getDD() {
    return dd;
  }
  /**
   * call to setup dragging in from the outside (say toolbar), by specifying the class selection and options.
   * Called during GridStack.init() as options, but can also be called directly (last param are used) in case the toolbar
   * is dynamically create and needs to be set later.
   * @param dragIn string selector (ex: '.sidebar-item') or list of dom elements
   * @param dragInOptions options - see DDDragOpt. (default: {handle: '.grid-stack-item-content', appendTo: 'body'}
   * @param widgets GridStackWidget def to assign to each element which defines what to create on drop
   * @param root optional root which defaults to document (for shadow dom pass the parent HTMLDocument)
   */
  static setupDragIn(dragIn, dragInOptions, widgets, root = document) {
    if (dragInOptions?.pause !== void 0) {
      DDManager.pauseDrag = dragInOptions.pause;
    }
    dragInOptions = { appendTo: "body", helper: "clone", ...dragInOptions || {} };
    const els = typeof dragIn === "string" ? Utils.getElements(dragIn, root) : dragIn;
    els.forEach((el2, i) => {
      if (!dd.isDraggable(el2))
        dd.dragIn(el2, dragInOptions);
      if (widgets?.[i])
        el2.gridstackNode = widgets[i];
    });
  }
  /**
   * Enables/Disables dragging by the user for specific grid elements.
   * For all items and future items, use enableMove() instead. No-op for static grids.
   *
   * Note: If you want to prevent an item from moving due to being pushed around by another
   * during collision, use the 'locked' property instead.
   *
   * @param els widget element(s) or selector to modify
   * @param val if true widget will be draggable, assuming the parent grid isn't noMove or static
   * @returns the grid instance for chaining
   *
   * @example
   * // Make specific widgets draggable
   * grid.movable('.my-widget', true);
   *
   * // Disable dragging for specific widgets
   * grid.movable('#fixed-widget', false);
   */
  movable(els, val) {
    if (this.opts.staticGrid)
      return this;
    _GridStack.getElements(els).forEach((el2) => {
      const n = el2.gridstackNode;
      if (!n)
        return;
      val ? delete n.noMove : n.noMove = true;
      this.prepareDragDrop(n.el);
    });
    return this;
  }
  /**
   * Enables/Disables user resizing for specific grid elements.
   * For all items and future items, use enableResize() instead. No-op for static grids.
   *
   * @param els widget element(s) or selector to modify
   * @param val if true widget will be resizable, assuming the parent grid isn't noResize or static
   * @returns the grid instance for chaining
   *
   * @example
   * // Make specific widgets resizable
   * grid.resizable('.my-widget', true);
   *
   * // Disable resizing for specific widgets
   * grid.resizable('#fixed-size-widget', false);
   */
  resizable(els, val) {
    if (this.opts.staticGrid)
      return this;
    _GridStack.getElements(els).forEach((el2) => {
      const n = el2.gridstackNode;
      if (!n)
        return;
      val ? delete n.noResize : n.noResize = true;
      this.prepareDragDrop(n.el);
    });
    return this;
  }
  /**
   * Temporarily disables widgets moving/resizing.
   * If you want a more permanent way (which freezes up resources) use `setStatic(true)` instead.
   *
   * Note: This is a no-op for static grids.
   *
   * This is a shortcut for:
   * ```typescript
   * grid.enableMove(false);
   * grid.enableResize(false);
   * ```
   *
   * @param recurse if true (default), sub-grids also get updated
   * @returns the grid instance for chaining
   *
   * @example
   * // Disable all interactions
   * grid.disable();
   *
   * // Disable only this grid, not sub-grids
   * grid.disable(false);
   */
  disable(recurse = true) {
    if (this.opts.staticGrid)
      return this;
    this.enableMove(false, recurse);
    this.enableResize(false, recurse);
    this._triggerEvent("disable");
    return this;
  }
  /**
   * Re-enables widgets moving/resizing - see disable().
   * Note: This is a no-op for static grids.
   *
   * This is a shortcut for:
   * ```typescript
   * grid.enableMove(true);
   * grid.enableResize(true);
   * ```
   *
   * @param recurse if true (default), sub-grids also get updated
   * @returns the grid instance for chaining
   *
   * @example
   * // Re-enable all interactions
   * grid.enable();
   *
   * // Enable only this grid, not sub-grids
   * grid.enable(false);
   */
  enable(recurse = true) {
    if (this.opts.staticGrid)
      return this;
    this.enableMove(true, recurse);
    this.enableResize(true, recurse);
    this._triggerEvent("enable");
    return this;
  }
  /**
   * Enables/disables widget moving for all widgets. No-op for static grids.
   * Note: locally defined items (with noMove property) still override this setting.
   *
   * @param doEnable if true widgets will be movable, if false moving is disabled
   * @param recurse if true (default), sub-grids also get updated
   * @returns the grid instance for chaining
   *
   * @example
   * // Enable moving for all widgets
   * grid.enableMove(true);
   *
   * // Disable moving for all widgets
   * grid.enableMove(false);
   *
   * // Enable only this grid, not sub-grids
   * grid.enableMove(true, false);
   */
  enableMove(doEnable, recurse = true) {
    if (this.opts.staticGrid)
      return this;
    doEnable ? delete this.opts.disableDrag : this.opts.disableDrag = true;
    this.engine.nodes.forEach((n) => {
      this.prepareDragDrop(n.el);
      if (n.subGrid && recurse)
        n.subGrid.enableMove(doEnable, recurse);
    });
    return this;
  }
  /**
   * Enables/disables widget resizing for all widgets. No-op for static grids.
   * Note: locally defined items (with noResize property) still override this setting.
   *
   * @param doEnable if true widgets will be resizable, if false resizing is disabled
   * @param recurse if true (default), sub-grids also get updated
   * @returns the grid instance for chaining
   *
   * @example
   * // Enable resizing for all widgets
   * grid.enableResize(true);
   *
   * // Disable resizing for all widgets
   * grid.enableResize(false);
   *
   * // Enable only this grid, not sub-grids
   * grid.enableResize(true, false);
   */
  enableResize(doEnable, recurse = true) {
    if (this.opts.staticGrid)
      return this;
    doEnable ? delete this.opts.disableResize : this.opts.disableResize = true;
    this.engine.nodes.forEach((n) => {
      this.prepareDragDrop(n.el);
      if (n.subGrid && recurse)
        n.subGrid.enableResize(doEnable, recurse);
    });
    return this;
  }
  /** @internal call when drag (and drop) needs to be cancelled (Esc key) */
  cancelDrag() {
    const dragEl = DDManager.dragElement?.el;
    if (dragEl?._gridstackNodeOrig) {
      const origNode = dragEl._gridstackNodeOrig;
      const origGrid = origNode.grid;
      const n2 = this._placeholder?.gridstackNode;
      if (n2) {
        n2._isAboutToRemove = true;
        this.engine.removeNode(n2);
      }
      this.engine.restoreInitial();
      dragEl.gridstackNode = origNode;
      delete dragEl._gridstackNodeOrig;
      delete DDManager.dropElement;
      if (origGrid) {
        origGrid.engine.addNode(origNode, false);
        origGrid.engine.restoreInitial();
      }
      return;
    }
    const n = this._placeholder?.gridstackNode;
    if (!n)
      return;
    if (n._isExternal) {
      n._isAboutToRemove = true;
      this.engine.removeNode(n);
    } else if (n._isAboutToRemove) {
      _GridStack._itemRemoving(n.el, false);
    }
    this.engine.restoreInitial();
  }
  /** @internal removes any drag&drop present (called during destroy) */
  _removeDD(el2) {
    dd.draggable(el2, "destroy").resizable(el2, "destroy");
    if (el2.gridstackNode) {
      delete el2.gridstackNode._initDD;
    }
    delete el2.ddElement;
    return this;
  }
  /** @internal called to add drag over to support widgets being added externally */
  _setupAcceptWidget() {
    if (this.opts.staticGrid || !this.opts.acceptWidgets && !this.opts.removable) {
      dd.droppable(this.el, "destroy");
      return this;
    }
    let cellHeight, cellWidth;
    const onDrag = (event2, el2, helper) => {
      helper = helper || el2;
      const node = helper.gridstackNode;
      if (!node)
        return;
      if (!node.grid?.el) {
        helper.style.transform = `scale(${1 / this.dragTransform.xScale},${1 / this.dragTransform.yScale})`;
        const helperRect = helper.getBoundingClientRect();
        helper.style.left = helperRect.x + (this.dragTransform.xScale - 1) * (event2.clientX - helperRect.x) / this.dragTransform.xScale + "px";
        helper.style.top = helperRect.y + (this.dragTransform.yScale - 1) * (event2.clientY - helperRect.y) / this.dragTransform.yScale + "px";
        helper.style.transformOrigin = `0px 0px`;
      }
      let { top, left } = helper.getBoundingClientRect();
      const rect = this.el.getBoundingClientRect();
      left -= rect.left;
      top -= rect.top;
      const ui = {
        position: {
          top: top * this.dragTransform.xScale,
          left: left * this.dragTransform.yScale
        }
      };
      if (node._temporaryRemoved) {
        node.x = Math.max(0, Math.round(left / cellWidth));
        node.y = Math.max(0, Math.round(top / cellHeight));
        delete node.autoPosition;
        this.engine.nodeBoundFix(node);
        if (!this.engine.willItFit(node)) {
          node.autoPosition = true;
          if (!this.engine.willItFit(node)) {
            dd.off(el2, "drag");
            return;
          }
          if (node._willFitPos) {
            Utils.copyPos(node, node._willFitPos);
            delete node._willFitPos;
          }
        }
        this._onStartMoving(helper, event2, ui, node, cellWidth, cellHeight);
      } else {
        this._dragOrResize(helper, event2, ui, node, cellWidth, cellHeight);
      }
    };
    dd.droppable(this.el, {
      accept: (el2) => {
        const node = el2.gridstackNode || this._readAttr(el2, false);
        if (node?.grid === this)
          return true;
        if (!this.opts.acceptWidgets)
          return false;
        let canAccept = true;
        if (typeof this.opts.acceptWidgets === "function") {
          canAccept = this.opts.acceptWidgets(el2);
        } else {
          const selector = this.opts.acceptWidgets === true ? ".grid-stack-item" : this.opts.acceptWidgets;
          canAccept = el2.matches(selector);
        }
        if (canAccept && node && this.opts.maxRow) {
          const n = { w: node.w, h: node.h, minW: node.minW, minH: node.minH };
          canAccept = this.engine.willItFit(n);
        }
        return canAccept;
      }
    }).on(this.el, "dropover", (event2, el2, helper) => {
      let node = helper?.gridstackNode || el2.gridstackNode;
      if (node?.grid === this && !node._temporaryRemoved) {
        return false;
      }
      if (node?._sidebarOrig) {
        node.w = node._sidebarOrig.w;
        node.h = node._sidebarOrig.h;
      }
      if (node?.grid && node.grid !== this && !node._temporaryRemoved) {
        const otherGrid = node.grid;
        otherGrid._leave(el2, helper);
      }
      helper = helper || el2;
      cellWidth = this.cellWidth();
      cellHeight = this.getCellHeight(true);
      if (!node) {
        const attr = helper.getAttribute("data-gs-widget") || helper.getAttribute("gridstacknode");
        if (attr) {
          try {
            node = JSON.parse(attr);
          } catch (error) {
            console.error("Gridstack dropover: Bad JSON format: ", attr);
          }
          helper.removeAttribute("data-gs-widget");
          helper.removeAttribute("gridstacknode");
        }
        if (!node)
          node = this._readAttr(helper);
        node._sidebarOrig = { w: node.w, h: node.h };
      }
      if (!node.grid) {
        if (!node.el)
          node = { ...node };
        node._isExternal = true;
        helper.gridstackNode = node;
      }
      const w = node.w || Math.round(helper.offsetWidth / cellWidth) || 1;
      const h = node.h || Math.round(helper.offsetHeight / cellHeight) || 1;
      if (node.grid && node.grid !== this) {
        if (!el2._gridstackNodeOrig)
          el2._gridstackNodeOrig = node;
        el2.gridstackNode = node = { ...node, w, h, grid: this };
        delete node.x;
        delete node.y;
        this.engine.cleanupNode(node).nodeBoundFix(node);
        node._initDD = node._isExternal = // DOM needs to be re-parented on a drop
        node._temporaryRemoved = true;
      } else {
        node.w = w;
        node.h = h;
        node._temporaryRemoved = true;
      }
      _GridStack._itemRemoving(node.el, false);
      dd.on(el2, "drag", onDrag);
      onDrag(event2, el2, helper);
      return false;
    }).on(this.el, "dropout", (event2, el2, helper) => {
      const node = helper?.gridstackNode || el2.gridstackNode;
      if (!node)
        return false;
      if (!node.grid || node.grid === this) {
        this._leave(el2, helper);
        if (this._isTemp) {
          this.removeAsSubGrid(node);
        }
      }
      return false;
    }).on(this.el, "drop", (event2, el2, helper) => {
      const node = helper?.gridstackNode || el2.gridstackNode;
      if (node?.grid === this && !node._isExternal)
        return false;
      const wasAdded = !!this.placeholder.parentElement;
      const wasSidebar = el2 !== helper;
      this.placeholder.remove();
      delete this.placeholder.gridstackNode;
      if (wasAdded && this.opts.animate) {
        this.setAnimation(false);
        this.setAnimation(true, true);
      }
      const origNode = el2._gridstackNodeOrig;
      delete el2._gridstackNodeOrig;
      if (wasAdded && origNode?.grid && origNode.grid !== this) {
        const oGrid = origNode.grid;
        oGrid.engine.removeNodeFromLayoutCache(origNode);
        oGrid.engine.removedNodes.push(origNode);
        oGrid._triggerRemoveEvent()._triggerChangeEvent();
        if (oGrid.parentGridNode && !oGrid.engine.nodes.length && oGrid.opts.subGridDynamic) {
          oGrid.removeAsSubGrid();
        }
      }
      if (!node)
        return false;
      if (wasAdded) {
        this.engine.cleanupNode(node);
        node.grid = this;
      }
      delete node.grid?._isTemp;
      dd.off(el2, "drag");
      if (helper && helper !== el2) {
        helper.remove();
        el2 = helper;
      } else {
        el2.remove();
      }
      this._removeDD(el2);
      if (!wasAdded)
        return false;
      const subGrid = node.subGrid?.el?.gridstack;
      Utils.copyPos(node, this._readAttr(this.placeholder));
      Utils.removePositioningStyles(el2);
      if (wasSidebar && (node.content || node.subGridOpts || _GridStack.addRemoveCB)) {
        delete node.el;
        el2 = this.addWidget(node) || el2;
      } else {
        this._prepareElement(el2, true, node);
        this.el.appendChild(el2);
        this.resizeToContentCheck(false, node);
        if (subGrid) {
          subGrid.parentGridNode = node;
        }
        this._updateContainerHeight();
      }
      this.engine.addedNodes.push(node);
      this._triggerAddEvent();
      this._triggerChangeEvent();
      this.engine.endUpdate();
      if (this._gsEventHandler["dropped"]) {
        this._gsEventHandler["dropped"]({ ...event2, type: "dropped" }, origNode && origNode.grid ? origNode : void 0, node);
      }
      return false;
    });
    return this;
  }
  /** @internal mark item for removal */
  static _itemRemoving(el2, remove) {
    if (!el2)
      return;
    const node = el2 ? el2.gridstackNode : void 0;
    if (!node?.grid || el2.classList.contains(node.grid.opts.removableOptions.decline))
      return;
    remove ? node._isAboutToRemove = true : delete node._isAboutToRemove;
    remove ? el2.classList.add("grid-stack-item-removing") : el2.classList.remove("grid-stack-item-removing");
  }
  /** @internal called to setup a trash drop zone if the user specifies it */
  _setupRemoveDrop() {
    if (typeof this.opts.removable !== "string")
      return this;
    const trashEl = document.querySelector(this.opts.removable);
    if (!trashEl)
      return this;
    if (!this.opts.staticGrid && !dd.isDroppable(trashEl)) {
      dd.droppable(trashEl, this.opts.removableOptions).on(trashEl, "dropover", (event2, el2) => _GridStack._itemRemoving(el2, true)).on(trashEl, "dropout", (event2, el2) => _GridStack._itemRemoving(el2, false));
    }
    return this;
  }
  /**
   * Re-scans one or more widget elements for drag handle elements after delayed content
   * (React portal, Angular component, etc.) has been rendered inside the item.
   * Only needed when you use a custom `draggable.handle` selector that lives *inside* the
   * item's dynamically-created content. The default `.grid-stack-item-content` handle is
   * created synchronously and never needs this call.
   *
   * @param els widget element(s) or selector
   *
   * @example
   * // React: after portal renders (see GridStackItem useEffect)
   * // Angular: after createComp() inside gsCreateNgComponents
   * grid.refreshDragHandles(itemEl);
   */
  refreshDragHandles(els) {
    _GridStack.getElements(els).forEach((el2) => {
      el2.ddElement?.ddDraggable?.refreshHandles();
    });
    return this;
  }
  /**
   * prepares the element for drag&drop - this is normally called by makeWidget() unless are are delay loading
   * @param el GridItemHTMLElement of the widget
   * @param [force=false]
   * */
  prepareDragDrop(el2, force = false) {
    const node = el2?.gridstackNode;
    if (!node)
      return this;
    const noMove = node.noMove || this.opts.disableDrag;
    const noResize = node.noResize || this.opts.disableResize;
    const disable = this.opts.staticGrid || noMove && noResize;
    if (force || disable) {
      if (node._initDD) {
        this._removeDD(el2);
        delete node._initDD;
      }
      if (disable) {
        el2.classList.add("ui-draggable-disabled", "ui-resizable-disabled");
        return this;
      }
    }
    if (!node._initDD) {
      let cellWidth;
      let cellHeight;
      const onStartMoving = (event2, ui) => {
        this.triggerEvent(event2, event2.target);
        cellWidth = this.cellWidth();
        cellHeight = this.getCellHeight(true);
        this._onStartMoving(el2, event2, ui, node, cellWidth, cellHeight);
      };
      const dragOrResize = (event2, ui) => {
        this._dragOrResize(el2, event2, ui, node, cellWidth, cellHeight);
      };
      const onEndMoving = (event2) => {
        this.placeholder.remove();
        delete this.placeholder.gridstackNode;
        delete node._moving;
        delete node._resizing;
        delete node._event;
        delete node._lastTried;
        const widthChanged = node.w !== node._orig.w;
        const target = event2.target;
        if (!target.gridstackNode || target.gridstackNode.grid !== this)
          return;
        node.el = target;
        if (node._isAboutToRemove) {
          const grid = el2.gridstackNode.grid;
          if (grid._gsEventHandler[event2.type]) {
            grid._gsEventHandler[event2.type](event2, target);
          }
          grid.engine.nodes.push(node);
          grid.removeWidget(el2, true, true);
        } else {
          Utils.removePositioningStyles(target);
          if (node._temporaryRemoved) {
            this._writePosAttr(target, node);
            this.engine.addNode(node);
          } else {
            this._writePosAttr(target, node);
          }
          this.triggerEvent(event2, target);
        }
        this._extraDragRow = 0;
        this._updateContainerHeight();
        this._triggerChangeEvent();
        this.engine.endUpdate();
        if (event2.type === "resizestop") {
          if (Number.isInteger(node.sizeToContent))
            node.sizeToContent = node.h;
          this.resizeToContentCheck(widthChanged, node);
        }
      };
      dd.draggable(el2, {
        start: onStartMoving,
        stop: onEndMoving,
        drag: dragOrResize,
        rtl: this.opts.rtl === "auto" ? void 0 : this.opts.rtl
      }).resizable(el2, {
        start: onStartMoving,
        stop: onEndMoving,
        resize: dragOrResize,
        rtl: this.opts.rtl === "auto" ? void 0 : this.opts.rtl
      });
      node._initDD = true;
    }
    dd.draggable(el2, noMove ? "disable" : "enable").resizable(el2, noResize ? "disable" : "enable");
    return this;
  }
  /** @internal handles actual drag/resize start */
  _onStartMoving(el2, event2, ui, node, cellWidth, cellHeight) {
    this.engine.cleanNodes().beginUpdate(node);
    this._writePosAttr(this.placeholder, node);
    this.el.appendChild(this.placeholder);
    this.placeholder.gridstackNode = node;
    if (node.grid?.el) {
      this.dragTransform = Utils.getValuesFromTransformedElement(el2);
    } else if (this.placeholder && this.placeholder.closest(".grid-stack")) {
      const gridEl = this.placeholder.closest(".grid-stack");
      this.dragTransform = Utils.getValuesFromTransformedElement(gridEl);
    } else {
      this.dragTransform = {
        xScale: 1,
        xOffset: 0,
        yScale: 1,
        yOffset: 0
      };
    }
    node.el = this.placeholder;
    node._lastUiPosition = ui.position;
    node._prevYPix = ui.position.top;
    node._moving = event2.type === "dragstart";
    node._resizing = event2.type === "resizestart";
    delete node._lastTried;
    if (event2.type === "dropover" && node._temporaryRemoved) {
      this.engine.addNode(node);
      node._moving = true;
    }
    this.engine.cacheRects(cellWidth, cellHeight, this.opts.marginTop, this.opts.marginRight, this.opts.marginBottom, this.opts.marginLeft);
    if (event2.type === "resizestart") {
      const colLeft = this.getColumn() - node.x;
      const rowLeft = (this.opts.maxRow || Number.MAX_SAFE_INTEGER) - node.y;
      dd.resizable(el2, "option", "minWidth", cellWidth * Math.min(node.minW || 1, colLeft)).resizable(el2, "option", "minHeight", cellHeight * Math.min(node.minH || 1, rowLeft)).resizable(el2, "option", "maxWidth", cellWidth * Math.min(node.maxW || Number.MAX_SAFE_INTEGER, colLeft)).resizable(el2, "option", "maxWidthMoveLeft", cellWidth * Math.min(node.maxW || Number.MAX_SAFE_INTEGER, node.x + node.w)).resizable(el2, "option", "maxHeight", cellHeight * Math.min(node.maxH || Number.MAX_SAFE_INTEGER, rowLeft)).resizable(el2, "option", "maxHeightMoveUp", cellHeight * Math.min(node.maxH || Number.MAX_SAFE_INTEGER, node.y + node.h));
    }
  }
  /** @internal handles actual drag/resize */
  _dragOrResize(el2, event2, ui, node, cellWidth, cellHeight) {
    const p = { ...node._orig };
    let resizing = false;
    let mLeft = this.opts.marginLeft, mRight = this.opts.marginRight, mTop = this.opts.marginTop, mBottom = this.opts.marginBottom;
    const mHeight = Math.round(cellHeight * 0.1), mWidth = Math.round(cellWidth * 0.1);
    mLeft = Math.min(mLeft, mWidth);
    mRight = Math.min(mRight, mWidth);
    mTop = Math.min(mTop, mHeight);
    mBottom = Math.min(mBottom, mHeight);
    if (event2.type === "drag") {
      if (node._temporaryRemoved)
        return;
      node._prevYPix = ui.position.top;
      if (this.opts.draggable.scroll !== false) {
        DDManager.dragElement?.updateScrollPosition(this.el);
      }
      const left = ui.position.left + (ui.position.left > node._lastUiPosition.left ? -mRight : mLeft);
      const top = ui.position.top + (ui.position.top > node._lastUiPosition.top ? -mBottom : mTop);
      p.x = Math.round(left / cellWidth);
      p.y = Math.round(top / cellHeight);
      const prev = this._extraDragRow;
      if (this.engine.collide(node, p)) {
        const row = this.getRow();
        let extra = Math.max(0, p.y + node.h - row);
        if (this.opts.maxRow && row + extra > this.opts.maxRow) {
          extra = Math.max(0, this.opts.maxRow - row);
        }
        this._extraDragRow = extra;
      } else
        this._extraDragRow = 0;
      if (this._extraDragRow !== prev)
        this._updateContainerHeight();
      if (node.x === p.x && node.y === p.y)
        return;
    } else if (event2.type === "resize") {
      if ((p.x ?? 0) < 0)
        return;
      Utils.updateScrollResize(event2, el2, cellHeight);
      p.w = Math.round((ui.size.width - mLeft) / cellWidth);
      p.h = Math.round((ui.size.height - mTop) / cellHeight);
      if (node.w === p.w && node.h === p.h)
        return;
      if (node._lastTried && node._lastTried.w === p.w && node._lastTried.h === p.h)
        return;
      if (event2.hasMovedX) {
        const calcPX = node.x - (p.w - node.w);
        p.x = calcPX < 0 ? 0 : calcPX;
      }
      if (event2.hasMovedY) {
        const calcPY = node.y - (p.h - node.h);
        p.y = calcPY < 0 ? 0 : calcPY;
      }
      resizing = true;
    }
    node._event = event2;
    node._lastTried = p;
    const rect = {
      x: ui.position.left + mLeft,
      y: ui.position.top + mTop,
      w: (ui.size ? ui.size.width : node.w * cellWidth) - mLeft - mRight,
      h: (ui.size ? ui.size.height : node.h * cellHeight) - mTop - mBottom
    };
    if (this.engine.moveNodeCheck(node, { ...p, cellWidth, cellHeight, rect, resizing })) {
      node._lastUiPosition = ui.position;
      this.engine.cacheRects(cellWidth, cellHeight, mTop, mRight, mBottom, mLeft);
      delete node._skipDown;
      if (resizing && node.subGrid)
        node.subGrid.onResize();
      this._extraDragRow = 0;
      this._updateContainerHeight();
      const target = event2.target;
      if (!node._sidebarOrig) {
        this._writePosAttr(target, node);
      }
      this.triggerEvent(event2, target);
    }
  }
  /** call given event callback on our main top-most grid (if we're nested) */
  triggerEvent(event2, target) {
    let grid = this;
    while (grid.parentGridNode)
      grid = grid.parentGridNode.grid;
    if (grid._gsEventHandler[event2.type]) {
      grid._gsEventHandler[event2.type](event2, target);
    }
  }
  /** @internal called when item leaving our area by either cursor dropout event
   * or shape is outside our boundaries. remove it from us, and mark temporary if this was
   * our item to start with else restore prev node values from prev grid it came from.
   */
  _leave(el2, helper) {
    helper = helper || el2;
    const node = helper.gridstackNode;
    if (!node)
      return;
    helper.style.transform = helper.style.transformOrigin = "";
    dd.off(el2, "drag");
    if (node._temporaryRemoved)
      return;
    node._temporaryRemoved = true;
    this.engine.removeNode(node);
    node.el = node._isExternal && helper ? helper : el2;
    const sidebarOrig = node._sidebarOrig;
    if (node._isExternal)
      this.engine.cleanupNode(node);
    node._sidebarOrig = sidebarOrig;
    if (this.opts.removable === true) {
      _GridStack._itemRemoving(el2, true);
    }
    if (el2._gridstackNodeOrig) {
      el2.gridstackNode = el2._gridstackNodeOrig;
      delete el2._gridstackNodeOrig;
    } else if (node._isExternal) {
      this.engine.restoreInitial();
    }
  }
};
GridStack.renderCB = (el2, w) => {
  if (el2 && w?.content)
    el2.textContent = w.content;
};
GridStack.resizeToContentParent = ".grid-stack-item-content";
GridStack.Utils = Utils;
GridStack.Engine = GridStackEngine;
GridStack.GDRev = "13.3.0";

// packages/core/src/streams.js
function resolveAPI(base, page = globalThis.location?.href) {
  const url = new URL(base || "./api/", page);
  if (!["http:", "https:"].includes(url.protocol) || new URL(page).protocol === "https:" && url.protocol !== "https:") throw new Error("API transport must be secure on HTTPS");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}
var SimulationClock = class {
  time = 0;
  rate = 1;
  paused = false;
  listeners = /* @__PURE__ */ new Set();
  constructor({ duration = 12e4, rate = 1, loop = false } = {}) {
    this.duration = Number.isFinite(duration) && duration > 0 ? duration : 12e4;
    this.rate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    this.loop = !!loop;
    this.last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      if (!this.paused) {
        let next = this.time + (now - this.last) * this.rate;
        if (this.loop && next >= this.duration) next %= this.duration;
        this.seek(next);
      }
      this.last = now;
    }, 250);
  }
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.time);
    return () => this.listeners.delete(fn);
  }
  seek(ms) {
    this.time = Math.min(this.duration, Math.max(0, Number(ms) || 0));
    for (const fn of this.listeners) fn(this.time);
  }
  pause() {
    this.paused = true;
  }
  play() {
    this.last = Date.now();
    this.paused = false;
  }
  destroy() {
    clearInterval(this.timer);
    this.listeners.clear();
  }
};
function boundedRecords(records2, envelope, limit = 600, windowMs = 6e5) {
  if (envelope?.version !== 1 || !Number.isInteger(envelope.seq) || !Number.isFinite(Date.parse(envelope.timestamp)) || !envelope.streamId || typeof envelope.epoch !== "string") return records2;
  if (envelope.kind === "heartbeat") return records2;
  let next = records2;
  if (records2.length && records2.at(-1).epoch !== envelope.epoch) next = [];
  if (next.length && next.at(-1).seq >= envelope.seq) return records2;
  const cutoff = Date.parse(envelope.timestamp) - windowMs;
  return [...next.filter((x) => Date.parse(x.timestamp) >= cutoff), envelope].slice(-limit);
}
async function readSSE(response, onEvent) {
  if (!response.body) throw new Error("Missing stream");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let type = "message";
        const data = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) type = line.slice(6).trim();
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length) {
          let parsed;
          try {
            parsed = JSON.parse(data.join("\n"));
          } catch {
            continue;
          }
          onEvent(type, parsed);
        }
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}
var StreamHub = class {
  constructor(definitions, { baseURL, apiBase, clock }) {
    this.defs = definitions;
    this.baseURL = baseURL;
    this.apiBase = resolveAPI(apiBase, baseURL);
    this.clock = clock;
    this.sources = /* @__PURE__ */ new Map();
    this.tick = setInterval(() => {
      for (const [id, s] of this.sources) if (s.listeners.size) this.emit(id, s);
    }, 500);
  }
  snapshot(id) {
    const s = this.sources.get(id);
    if (!s) return { records: [], state: "connecting", age: null };
    const age = s.records.length ? Math.max(0, (Date.now() - Date.parse(s.records.at(-1).timestamp)) / 1e3) : null;
    const state = this.defs[id]?.transport === "replay" ? s.state : globalThis.navigator?.onLine === false ? "offline" : s.state === "live" && age !== null && age > 6 ? "stale" : s.state;
    return { records: s.records, state, age: state === "replay" ? 0 : age };
  }
  emit(id, s) {
    const snap = this.snapshot(id);
    for (const fn of s.listeners) fn(snap);
  }
  subscribe(id, fn) {
    if (!this.defs[id]) {
      fn({ records: [], state: "disconnected", age: null });
      return () => {
      };
    }
    let s = this.sources.get(id);
    if (!s) {
      s = { records: [], state: "connecting", listeners: /* @__PURE__ */ new Set(), attempt: 0, generation: 0 };
      this.sources.set(id, s);
    }
    s.listeners.add(fn);
    fn(this.snapshot(id));
    if (s.listeners.size === 1) {
      s.stopped = false;
      this.start(id, s);
    }
    return () => {
      s.listeners.delete(fn);
      if (!s.listeners.size) {
        s.stopped = true;
        s.generation++;
        s.abort?.abort();
        s.socket?.close();
        clearTimeout(s.retry);
        s.unclock?.();
      }
    };
  }
  async start(id, s) {
    const def = this.defs[id], generation = ++s.generation;
    const current = () => !s.stopped && s.generation === generation;
    if (def.transport === "replay") {
      s.abort = new AbortController();
      try {
        const response = await fetch(new URL(def.path, this.baseURL), { signal: s.abort.signal });
        if (!response.ok) throw new Error("Replay unavailable");
        const baked = await response.json();
        if (!current()) return;
        s.unclock = this.clock.subscribe((time2) => {
          if (!current()) return;
          s.records = baked.filter((x) => x.at <= time2).map((x) => x.envelope).slice(-600);
          if (s.records.length) {
            const cutoff = Date.parse(s.records.at(-1).timestamp) - 6e5;
            s.records = s.records.filter((x) => Date.parse(x.timestamp) >= cutoff);
          }
          s.state = "replay";
          this.emit(id, s);
        });
      } catch (e) {
        if (current() && e.name !== "AbortError") {
          s.state = "disconnected";
          this.emit(id, s);
        }
      }
      return;
    }
    if (s.attempt >= 3 && !s.fallback) {
      s.fallback = true;
      s.nextProbeAt = Date.now() + 3e4;
    }
    const poll = def.transport === "polling" || s.fallback && Date.now() < s.nextProbeAt;
    if (s.fallback && !poll) s.nextProbeAt = Date.now() + 3e4;
    const schedule = (delay) => {
      if (current()) s.retry = setTimeout(() => {
        if (current()) this.start(id, s);
      }, delay);
    };
    const retry = () => {
      if (!current()) return;
      s.state = "disconnected";
      this.emit(id, s);
      s.attempt++;
      schedule(s.fallback ? 2e3 : Math.min(1e4, 500 * 2 ** Math.min(s.attempt, 5)) * (0.85 + Math.random() * 0.3));
    };
    const accept = (e) => {
      if (!current() || e.streamId !== id) return;
      const next = boundedRecords(s.records, e);
      if (next !== s.records) {
        s.records = next;
        s.attempt = 0;
        if (!poll) s.fallback = false;
        s.state = "live";
        this.emit(id, s);
      }
    };
    const url = new URL(def.path, this.apiBase);
    if (def.transport === "websocket" && !poll) {
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = s.socket = new WebSocket(url);
      ws.onmessage = (e) => {
        try {
          accept(JSON.parse(e.data));
        } catch {
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = retry;
      return;
    }
    s.abort = new AbortController();
    try {
      if (poll) url.searchParams.set("poll", "1");
      const response = await fetch(url, { signal: s.abort.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Feed unavailable");
      if (poll) {
        const rows = await response.json();
        for (const row of rows) accept(row);
        schedule(2e3);
      } else {
        await readSSE(response, (type, data) => {
          if (type === "message") accept(data);
        });
        retry();
      }
    } catch (e) {
      if (e.name !== "AbortError") retry();
    }
  }
  destroy() {
    clearInterval(this.tick);
    for (const s of this.sources.values()) {
      s.stopped = true;
      s.generation++;
      s.abort?.abort();
      s.socket?.close();
      clearTimeout(s.retry);
      s.unclock?.();
      s.listeners.clear();
    }
    this.sources.clear();
  }
};

// packages/core/src/ai.js
async function askPanel({ url, request, signal, token, onEvent }) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(request), signal, cache: "no-store" });
    if (!response.ok) {
      onEvent("error", { code: response.status === 429 ? "rate_limited" : response.status === 401 ? "unauthorized" : "unavailable", message: "AI unavailable" });
      return;
    }
    let terminal = false;
    await readSSE(response, (type, data) => {
      if (type === "done" || type === "error") terminal = true;
      onEvent(type, data);
    });
    if (!terminal && !signal?.aborted) onEvent("error", { code: "unavailable", message: "AI stream ended" });
  } catch (e) {
    if (e.name !== "AbortError") onEvent("error", { code: "unavailable", message: "AI unavailable" });
  }
}
function aiErrorKey(code) {
  return code === "busy" ? "busy" : code === "rate_limited" ? "rateLimited" : "unavailable";
}

// packages/core/src/map-protocol.js
var CHANNEL = "panel-core.map";
var COMMANDS = ["flyTo", "highlight", "setLayers", "setTime", "setTheme", "appCommand"];
var object = (p) => p !== null && typeof p === "object" && !Array.isArray(p);
var entity = (p) => object(p) && typeof p.id === "string" && typeof p.label === "string";
var strings = (a) => Array.isArray(a) && a.every((x) => typeof x === "string");
var appMessage = (p) => {
  if (typeof p.name !== "string" || !p.name.length || p.name.length > 64 || !Object.hasOwn(p, "payload")) return false;
  try {
    structuredClone(p.payload);
    return true;
  } catch {
    return false;
  }
};
function command(type, p) {
  if (!object(p)) return false;
  if (type === "flyTo") return typeof p.target === "string" || object(p.target) && (typeof p.target.id === "string" || Number.isFinite(p.target.lon) && Math.abs(p.target.lon) <= 180 && Number.isFinite(p.target.lat) && Math.abs(p.target.lat) <= 90 && (p.target.alt === void 0 || Number.isFinite(p.target.alt)));
  if (type === "highlight") return strings(p.ids);
  if (type === "setLayers") return strings(p.layers);
  if (type === "setTime") return Number.isFinite(p.t);
  if (type === "setTheme") return typeof p.theme === "string";
  if (type === "appCommand") return appMessage(p);
  return false;
}
function event(type, p) {
  if (!object(p)) return false;
  return type === "ready" ? strings(p.capabilities) : ["select", "hover"].includes(type) ? p.entity === null || entity(p.entity) : type === "time" ? Number.isFinite(p.t) : type === "appEvent" ? appMessage(p) : type === "viewChanged" && Object.hasOwn(p, "view");
}
var message = (type, payload2) => ({ channel: CHANNEL, version: 1, type, payload: payload2 });

// packages/core/src/map.js
var commands = new Set(COMMANDS);
var MapHost = class {
  constructor(iframe, { onLoad = () => {
  }, onReady = () => {
  }, onSelect = () => {
  }, onHover = () => {
  }, onTime = () => {
  }, onViewChanged = () => {
  }, onAppEvent = () => {
  } } = {}) {
    this.frame = iframe;
    this.pending = /* @__PURE__ */ new Map();
    this.capabilities = /* @__PURE__ */ new Set();
    this.ready = false;
    this.readyInfo = null;
    this.destroyed = false;
    this.receive = (e) => {
      const m = e.data;
      if (this.destroyed || e.source !== iframe.contentWindow || e.origin !== location.origin || m?.channel !== CHANNEL || m.version !== 1 || !event(m.type, m.payload)) return;
      const p = m.payload;
      if (m.type === "ready") {
        this.readyInfo = structuredClone(p);
        this.capabilities = new Set(p.capabilities.filter((x) => commands.has(x)));
        this.ready = true;
        for (const [type, payload2] of this.pending) this.send(type, payload2);
        this.pending.clear();
        onReady(structuredClone(p));
      }
      if (m.type === "select") onSelect(p.entity);
      if (m.type === "hover" && (p.entity === null || p.entity && typeof p.entity.id === "string" && typeof p.entity.label === "string")) onHover(p.entity);
      if (m.type === "time" && Number.isFinite(p.t)) onTime(p.t);
      if (m.type === "viewChanged") onViewChanged(p.view);
      if (m.type === "appEvent") onAppEvent(p);
    };
    this.reload = () => {
      this.ready = false;
      this.readyInfo = null;
      this.capabilities.clear();
      onLoad();
      iframe.contentWindow?.postMessage(message("hello", {}), location.origin);
    };
    window.addEventListener("message", this.receive);
    iframe.addEventListener("load", this.reload);
    this.reload();
  }
  send(type, payload2) {
    if (this.destroyed || !command(type, payload2)) return false;
    let copy;
    try {
      copy = structuredClone(payload2);
    } catch {
      return false;
    }
    if (!this.ready) {
      this.pending.set(type, copy);
      return true;
    }
    if (!this.capabilities.has(type)) return false;
    this.frame.contentWindow?.postMessage(message(type, copy), location.origin);
    return true;
  }
  destroy() {
    this.destroyed = true;
    window.removeEventListener("message", this.receive);
    this.frame.removeEventListener("load", this.reload);
    this.pending.clear();
    this.readyInfo = null;
    this.ready = false;
  }
};

// packages/core/src/locales.js
var translations = {
  "zh-Hant": { panels: "\u9762\u677F", noPanels: "\u6C92\u6709\u9762\u677F", showMap: "\u986F\u793A\u5730\u5716", showPanels: "\u986F\u793A\u9762\u677F", moveEarlier: "\u79FB\u5230\u524D\u9762", moveLater: "\u79FB\u5230\u5F8C\u9762", stepBack: "\u4E0A\u4E00\u6642\u9593\u9EDE", stepForward: "\u4E0B\u4E00\u6642\u9593\u9EDE", reset: "\u91CD\u8A2D\u7248\u9762", add: "\u65B0\u589E\u9762\u677F", locale: "\u8A9E\u8A00", token: "\u793A\u7BC4 API \u6B0A\u6756", replay: "\u56DE\u653E", play: "\u64AD\u653E", pause: "\u66AB\u505C", speed: "\u901F\u5EA6", seek: "\u6642\u9593", close: "\u95DC\u9589", collapse: "\u6536\u5408", expand: "\u5C55\u958B", maximize: "\u6700\u5927\u5316", restore: "\u9084\u539F", moveLeft: "\u5411\u5DE6\u79FB\u52D5", moveRight: "\u5411\u53F3\u79FB\u52D5", moveUp: "\u5411\u4E0A\u79FB\u52D5", moveDown: "\u5411\u4E0B\u79FB\u52D5", grow: "\u653E\u5927", shrink: "\u7E2E\u5C0F", menu: "\u9762\u677F\u64CD\u4F5C", ask: "\u8A62\u554F AI", send: "\u9001\u51FA", askPlaceholder: "\u8A62\u554F\u9019\u500B\u9762\u677F\u2026", askPreset: "\u6700\u8FD1 10 \u5206\u9418\u6709\u4EC0\u9EBC\u8B8A\u5316\uFF1F", thinking: "\u6574\u7406\u8CC7\u6599\u4E2D\u2026", queued: "\u5DF2\u6392\u5165\u4F47\u5217", busy: "AI \u4F47\u5217\u5DF2\u6EFF\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66", rateLimited: "\u8ACB\u6C42\u904E\u65BC\u983B\u7E41\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66", started: "\u751F\u6210\u4E2D", unavailable: "AI \u66AB\u6642\u7121\u6CD5\u4F7F\u7528", grounded: "\u6578\u503C\u7B26\u5408\u8CC7\u6599", flagged: "\u6578\u503C\u9700\u8981\u67E5\u6838", fake: "\u6A21\u64EC AI\uFF08\u975E\u771F\u5BE6\u6A21\u578B\uFF09", mocked: "\u6A21\u64EC\u8CC7\u6599", noData: "\u76EE\u524D\u6C92\u6709\u8CC7\u6599", selection: "\u9078\u53D6\u9805\u76EE", chat: "AI \u52A9\u624B", map: "\u53C3\u8003\u5730\u5716", weather: "\u5929\u6C23", alerts: "\u8B66\u5831", news: "\u65B0\u805E", video: "\u5F71\u50CF", plot: "\u6642\u9593\u5E8F\u5217", source: "\u4F86\u6E90", value: "\u6578\u503C", unit: "\u55AE\u4F4D", previous: "\u4E0A\u4E00\u500B\u9762\u677F", next: "\u4E0B\u4E00\u500B\u9762\u677F", settings: "\u8A2D\u5B9A", state: { connecting: "\u9023\u7DDA\u4E2D", ready: "\u5C31\u7DD2", live: "\u5373\u6642", stale: "\u8CC7\u6599\u904E\u671F", disconnected: "\u5DF2\u65B7\u7DDA", offline: "\u96E2\u7DDA", replay: "\u56DE\u653E", selected: "\u5DF2\u9078\u53D6" } },
  en: { panels: "Panels", noPanels: "No panels", showMap: "Show map", showPanels: "Show panels", moveEarlier: "Move earlier", moveLater: "Move later", stepBack: "Previous time step", stepForward: "Next time step", reset: "Reset layout", add: "Add panel", locale: "Language", token: "Demo API token", replay: "Replay", play: "Play", pause: "Pause", speed: "Speed", seek: "Time", close: "Close", collapse: "Collapse", expand: "Expand", maximize: "Maximize", restore: "Restore", moveLeft: "Move left", moveRight: "Move right", moveUp: "Move up", moveDown: "Move down", grow: "Grow", shrink: "Shrink", menu: "Panel actions", ask: "Ask AI", send: "Send", askPlaceholder: "Ask about this panel\u2026", askPreset: "What changed in the last 10 minutes?", thinking: "Preparing context\u2026", queued: "Queued", busy: "AI queue is full. Try again later.", rateLimited: "Too many requests. Try again later.", started: "Generating", unavailable: "AI is unavailable", grounded: "Values match supplied data", flagged: "Values need checking", fake: "FAKE AI (not a real model)", mocked: "Mock data", noData: "No data yet", selection: "Selection", chat: "AI assistant", map: "Reference map", weather: "Weather", alerts: "Alerts", news: "News", video: "Video", plot: "Time series", source: "Source", value: "Value", unit: "Unit", previous: "Previous panel", next: "Next panel", settings: "Settings", state: { connecting: "Connecting", ready: "Ready", live: "Live", stale: "Stale", disconnected: "Disconnected", offline: "Offline", replay: "Replay", selected: "Selected" } }
};
var supportedLocales = Object.freeze(Object.keys(translations));
function createI18n(initial = "zh-Hant") {
  let locale = translations[initial] ? initial : "zh-Hant";
  return { get locale() {
    return locale;
  }, setLocale(v) {
    if (translations[v]) locale = v;
    return locale;
  }, t(key) {
    return key.split(".").reduce((o, k) => o?.[k], translations[locale]) || key;
  } };
}
function formatAge(seconds, locale = "zh-Hant") {
  if (!Number.isFinite(seconds)) return "\u2014";
  const n = Math.max(0, Math.round(seconds));
  return locale === "en" ? `${n}s ago` : `${n} \u79D2\u524D`;
}
function freshnessText(state, age, i18n) {
  const label = i18n.t("state." + state);
  return Number.isFinite(age) ? `${label} \xB7 ${formatAge(age, i18n.locale)}` : label;
}

// packages/core/src/panels.js
var element = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};
var records = (s) => Array.isArray(s?.records) ? s.records : [];
var payload = (r) => r?.payload && typeof r.payload === "object" ? r.payload : {};
var description = (kind, s) => ({ schemaVersion: 1, kind, units: [...new Set(records(s).map((r) => payload(r).unit).filter(Boolean))], visibleFields: ["timestamp", "value", "unit", "headline", "message", "severity", "entityId"], summary: "Only the supplied bounded history is available." });
var time = (v, locale) => new Date(v).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
var timeSeries = {
  id: "time-series",
  title: "Time series",
  icon: "\u25CC",
  defaultSize: { w: 4, h: 3 },
  render(container, ctx) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg"), poly = document.createElementNS(ns, "polyline");
    svg.classList.add("series-plot");
    svg.setAttribute("viewBox", "0 0 100 42");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", ctx.t("plot"));
    poly.setAttribute("fill", "none");
    poly.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(poly);
    const value = element("div", "\u2014", "current-value"), table = element("table", null, "data-table"), caption = element("caption", ctx.t("plot")), head = element("thead"), row = element("tr"), body = element("tbody");
    for (const key of ["seek", "value", "unit"]) row.append(element("th", ctx.t(key)));
    head.append(row);
    table.append(caption, head, body);
    container.append(value, svg, table);
    return { ctx, poly, body, value };
  },
  update(v, s) {
    const rows = records(s).slice(-40), values = rows.map((r) => Number(payload(r).value)).filter(Number.isFinite), min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    v.poly.setAttribute("points", rows.map((r, i) => `${i / Math.max(1, rows.length - 1) * 100},${38 - (Number(payload(r).value) - min) / span * 34}`).join(" "));
    const last = payload(rows.at(-1));
    v.value.textContent = last.value == null ? "\u2014" : `${last.value} ${last.unit || ""}`;
    v.body.replaceChildren(...rows.slice(-6).reverse().map((r) => {
      const tr = element("tr");
      for (const val of [time(r.timestamp, v.ctx.locale), payload(r).value, payload(r).unit]) tr.append(element("td", val));
      return tr;
    }));
  },
  describeForAI: (s) => description("time-series", s),
  dispose() {
  }
};
var eventList = { id: "event-list", title: "Events", icon: "\u25B3", defaultSize: { w: 4, h: 3 }, render(c, ctx) {
  const list = element("ul", null, "event-list");
  c.append(list);
  return { ctx, list };
}, update(v, s) {
  v.list.replaceChildren(...records(s).slice(-20).reverse().map((r) => {
    const p = payload(r), li = element("li");
    li.dataset.severity = p.severity || "info";
    li.append(element("small", `${p.severity || "info"} \xB7 ${time(r.timestamp, v.ctx.locale)}`), element("p", p.message || p.label));
    if (p.entityId) {
      const button = element("button", p.entityId, "entity-link");
      button.dataset.entity = p.entityId;
      button.onclick = () => v.ctx.focusEntity(p.entityId);
      li.append(button);
    }
    return li;
  }));
}, describeForAI: (s) => description("event-list", s), dispose() {
} };
var headlines = { id: "headline-list", title: "Headlines", icon: "\u2261", defaultSize: { w: 4, h: 3 }, render(c, ctx) {
  const list = element("div", null, "headline-list");
  c.append(list);
  return { ctx, list };
}, update(v, s) {
  v.list.replaceChildren(...records(s).slice(-15).reverse().map((r) => {
    const p = payload(r), article = element("article");
    article.append(element("h3", p.headline || p.label), element("small", time(r.timestamp, v.ctx.locale)));
    return article;
  }));
}, describeForAI: (s) => description("headline-list", s), dispose() {
} };
var keyValue = { id: "key-value", title: "Status", icon: "\u21BA", defaultSize: { w: 4, h: 3 }, render(c, ctx) {
  const dl = element("dl", null, "key-values");
  c.append(dl);
  return { ctx, dl };
}, update(v, s) {
  v.dl.replaceChildren(...Object.entries(payload(records(s).at(-1))).filter(([, v2]) => ["string", "number", "boolean"].includes(typeof v2)).flatMap(([k, val]) => [element("dt", k), element("dd", val)]));
}, describeForAI: (s) => description("key-value", s), dispose() {
} };
var video = { id: "video", title: "Video", icon: "\u25B7", defaultSize: { w: 4, h: 3 }, render(c, ctx) {
  const frame = element("iframe", null, "video-frame");
  frame.title = ctx.t("video");
  frame.src = ctx.videoUrl;
  c.append(frame);
  return { frame };
}, update() {
}, describeForAI: (s) => description("video", s), dispose(v) {
  v.frame.remove();
} };
var selection = { id: "selection", title: "Selection", icon: "\u2316", defaultSize: { w: 4, h: 3 }, render(c, ctx) {
  const body = element("div", null, "selection-body");
  c.append(body);
  return { ctx, body };
}, update(v) {
  const e = v.ctx.getSelectedEntity();
  v.body.replaceChildren();
  if (!e) {
    v.body.textContent = v.ctx.t("noData");
    return;
  }
  v.body.append(element("h3", e.label || e.id));
  for (const [k, val] of Object.entries(e.properties || {}).slice(0, 24)) v.body.append(element("p", `${k}: ${typeof val === "object" ? JSON.stringify(val) : val}`));
}, describeForAI: (s) => description("selection", s), dispose() {
} };
var chat = { id: "chat", title: "Chat", icon: "\u2733", defaultSize: { w: 4, h: 3 }, render(c, ctx) {
  const p = element("p", ctx.t("askPlaceholder"));
  c.append(p);
  return {};
}, update() {
}, describeForAI: (s) => description("chat", s), dispose() {
} };
var builtins = Object.freeze({ "time-series": timeSeries, "event-list": eventList, "headline-list": headlines, "key-value": keyValue, video, selection, chat });
function panelDescription(type, snapshot) {
  return typeof type?.describeForAI === "function" ? type.describeForAI(snapshot) : description("panel", snapshot);
}

// packages/core/src/layout-state.js
var object2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var integer = (value, fallback, min, max) => {
  const n = typeof value === "number" || typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : fallback)));
};
function panelsFor(rows, { catalogue = [], preset = [] }, reset = false, legacy = false) {
  const descriptors = new Map(catalogue.map((p) => [p.id, p])), defaults = new Map(preset.map((p) => [p.id, p])), seen = /* @__PURE__ */ new Set();
  if (!descriptors.has("selection") && !defaults.has("selection")) descriptors.set("selection", { id: "selection", type: "selection" });
  return rows.filter((p) => object2(p) && typeof p.id === "string" && (descriptors.has(p.id) || defaults.has(p.id)) && !seen.has(p.id) && seen.add(p.id)).map((p) => {
    const descriptor = descriptors.get(p.id) || defaults.get(p.id), fallback = defaults.get(p.id) || {}, type = descriptor.type || p.type || p.id;
    const w = integer(p.w, fallback.w ?? descriptor.defaultSize?.w ?? 4, 2, 12), h = integer(p.h, fallback.h ?? descriptor.defaultSize?.h ?? 3, 2, 30);
    return { id: p.id, type, x: integer(p.x, fallback.x ?? 0, 0, 12 - w), y: integer(p.y, fallback.y ?? 0, 0, 100), w, h, collapsed: !reset && !(legacy && type === "map") && p.collapsed === true };
  });
}
function phoneFor(panels, current = {}, defaults = {}) {
  if (!object2(current)) current = {};
  if (!object2(defaults)) defaults = {};
  const derived = panels.filter((p) => p.type !== "map").sort((a, b) => a.y - b.y || a.x - b.x).map((p) => p.id);
  const requested = Array.isArray(current.order) ? current.order : Array.isArray(defaults.order) ? defaults.order : [];
  const order = [.../* @__PURE__ */ new Set([...requested, ...derived])].filter((id) => derived.includes(id));
  const chosen = current.activeId ?? defaults.activeId, activeId = order.includes(chosen) ? chosen : order[0] ?? null;
  return { order, activeId, collapsed: Object.fromEntries(order.map((id) => [id, current.collapsed?.[id] === true])), deckVisible: typeof current.deckVisible === "boolean" ? current.deckVisible : defaults.deckVisible !== false };
}
function defaultLayout(options) {
  const panels = panelsFor(options.preset || [], options, true);
  return { version: 2, appId: options.appId, panels, phone: phoneFor(panels, {}, options.phoneDefaults) };
}
function normalizeLayout(record, options) {
  if (!object2(record) || ![1, 2].includes(record.version) || record.appId !== options.appId || !Array.isArray(record.panels)) return null;
  const panels = panelsFor(record.panels, options, false, record.version === 1);
  return { version: 2, appId: options.appId, panels, phone: phoneFor(panels, record.version === 2 ? record.phone : { activeId: record.phoneActiveId }, options.phoneDefaults) };
}
function clearLayout(storage, appId) {
  for (const version of [1, 2]) storage.removeItem(`panel-core:layout:v${version}:${appId}`);
}

// packages/core/src/branding.js
function brandSubtitle(manifest) {
  const value = manifest?.subtitle;
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new TypeError("Invalid panel manifest: subtitle must be a string, null or absent");
  return value;
}

// packages/core/src/shell.js
var el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};
var clamp = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Math.round(Number(v)) : min));
function createApp(container, manifest) {
  if (!container || manifest?.version !== 1 || typeof manifest.id !== "string") throw new TypeError("Invalid panel manifest");
  const subtitle = brandSubtitle(manifest);
  const base = new URL(".", document.baseURI), apiBase = resolveAPI(manifest.apiBase, base), i18n = createI18n(manifest.locale), clock = new SimulationClock(manifest.clock), hub = new StreamHub(manifest.streams || {}, { baseURL: base.href, apiBase, clock });
  const mapUrl = new URL(manifest.mapUrl || "./map.html", base);
  if (mapUrl.origin !== base.origin) throw new TypeError("Map iframe must be same origin");
  const types = { ...builtins, ...manifest.panelTypes }, catalogue = manifest.catalogue || [], byId = new Map(catalogue.map((p) => [p.id, p])), panels = /* @__PURE__ */ new Map(), key = `panel-core:layout:v2:${manifest.id}`;
  const options = { appId: manifest.id, preset: manifest.preset || [], catalogue, phoneDefaults: manifest.layout?.phone };
  let state = readLayout(), ready = false, destroyed = false, selected = null, active = state.phone.activeId, token = "", maximized = null, changing = false, deckSaveTimer, compactOrder = null, compactCollapsed = {};
  const phone = matchMedia("(max-width: 767px)"), compact = matchMedia("(max-width: 1023px)");
  let mode = phone.matches ? "phone" : compact.matches ? "compact" : "desktop";
  const root = el("div", null, "panel-core-app");
  root.dataset.mode = mode;
  container.append(root);
  for (const [k, v] of Object.entries(manifest.theme || {})) if (/^[a-z-]+$/.test(k) && /^[#a-zA-Z0-9().,%\s-]+$/.test(v)) root.style.setProperty(`--panel-${k}`, v);
  function button(label2, action, cls) {
    const b = el("button", i18n.t(label2), cls);
    b.type = "button";
    b.dataset.label = label2;
    b.onclick = action;
    return b;
  }
  const top = el("header", null, "topbar"), brand = el("div", null, "brand");
  brand.append(el("span", "\u25EB", "brand-icon"), el("h1", manifest.title));
  if (subtitle != null) brand.append(el("small", subtitle));
  const controls = el("div", null, "topbar-controls");
  top.append(brand, controls);
  root.append(top);
  const manager = el("details", null, "panel-manager"), managerSummary = el("summary", i18n.t("panels")), managerBody = el("div");
  managerSummary.dataset.label = "panels";
  manager.append(managerSummary, managerBody);
  const resetButton = button("reset", () => {
    reset();
    if (mode === "phone") manager.open = false;
  });
  resetButton.dataset.action = "reset";
  const catalog = el("select");
  catalog.dataset.catalogue = "";
  catalog.setAttribute("aria-label", i18n.t("add"));
  for (const p of catalogue) {
    const o = el("option", i18n.t(p.titleKey || p.id));
    o.value = p.id;
    catalog.append(o);
  }
  const addButton = button("add", () => {
    const p = addPanel({ id: catalog.value });
    if (mode === "phone") manager.open = false;
    save();
    if (p) focus(p.id);
  });
  addButton.dataset.add = "";
  managerBody.append(catalog, addButton, resetButton);
  const settings = el("details", null, "app-settings"), summary = el("summary", i18n.t("settings")), settingsBody = el("div");
  settings.append(summary, settingsBody);
  manager.ontoggle = () => {
    if (mode === "phone" && manager.open) settings.open = false;
  };
  settings.ontoggle = () => {
    if (mode === "phone" && settings.open) manager.open = false;
  };
  const locale = el("select");
  locale.setAttribute("aria-label", i18n.t("locale"));
  for (const l of manifest.locales || ["zh-Hant", "en"]) {
    const o = el("option", l === "zh-Hant" ? "\u7E41\u4E2D" : "English");
    o.value = l;
    locale.append(o);
  }
  locale.value = i18n.locale;
  const tokenLabel = el("label", i18n.t("token")), tokenInput = el("input");
  tokenInput.type = "password";
  tokenInput.autocomplete = "off";
  tokenInput.oninput = () => token = tokenInput.value;
  tokenLabel.append(tokenInput);
  settingsBody.append(locale, tokenLabel);
  controls.append(manager, settings);
  const gridEl = el("section", null, "grid-stack panel-grid");
  gridEl.setAttribute("aria-label", manifest.title);
  root.append(gridEl);
  const grid = GridStack.init({ column: 12, cellHeight: 90, margin: 8, handle: ".panel-header", animate: false, alwaysShowResizeHandle: true, columnOpts: { breakpoints: [] }, draggable: { cancel: "button,input,select,summary,.panel-menu" } }, gridEl);
  const navigation = el("nav", null, "deck-navigation"), position = el("output"), previous = button("previous", () => navigate(-1)), next = button("next", () => navigate(1)), stow = button("showMap", () => {
    if (!ordered().length) {
      manager.open = true;
      catalog.focus();
      return;
    }
    state.phone.deckVisible = !state.phone.deckVisible;
    present();
    save();
  });
  position.dataset.deckPosition = "";
  position.setAttribute("aria-live", "polite");
  previous.dataset.deckPrevious = "";
  next.dataset.deckNext = "";
  stow.dataset.deckToggle = "";
  navigation.append(previous, position, next, stow);
  navigation.setAttribute("aria-label", i18n.t("panels"));
  root.append(navigation);
  const replayControls = el("div", null, "replay-controls"), play = button("pause", () => {
    clock.paused ? clock.play() : clock.pause();
    renderTime(clock.time);
  }), range = el("input"), timeLabel = el("output");
  const step = (direction) => {
    clock.pause();
    clock.seek(clock.time + direction * (manifest.clock?.step > 0 ? manifest.clock.step : 1e3));
  };
  const stepBack = button("stepBack", () => step(-1)), stepForward = button("stepForward", () => step(1));
  stepBack.textContent = "\u2212";
  stepForward.textContent = "+";
  range.type = "range";
  range.min = "0";
  range.max = String(clock.duration);
  range.step = String(manifest.clock?.step > 0 ? manifest.clock.step : 1e3);
  range.oninput = () => clock.seek(Number(range.value));
  const rate = el("select");
  for (const n of [.../* @__PURE__ */ new Set([...manifest.clock?.rates || [0.5, 1, 2], clock.rate])].filter((n2) => Number.isFinite(n2) && n2 > 0)) {
    const o = el("option", `${n}\xD7`);
    o.value = n;
    rate.append(o);
  }
  rate.value = String(clock.rate);
  rate.onchange = () => clock.rate = Number(rate.value);
  replayControls.append(play, stepBack, range, stepForward, rate, timeLabel);
  replayControls.hidden = manifest.clock?.controls === false;
  function readLayout() {
    for (const version of [2, 1]) {
      try {
        const value = JSON.parse(localStorage.getItem(`panel-core:layout:v${version}:${manifest.id}`));
        const normalized = normalizeLayout(value, options);
        if (normalized) return normalized;
      } catch {
      }
    }
    return defaultLayout(options);
  }
  function entry(raw) {
    const b = { ...byId.get(raw.id), ...(manifest.preset || []).find((p) => p.id === raw.id) };
    return { ...b, ...raw, type: raw.type || b.type || raw.id };
  }
  function valid(raw) {
    return raw && typeof raw.id === "string" && (raw.type === "map" || types[raw.type || byId.get(raw.id)?.type]);
  }
  function layout() {
    return [...panels.values()].filter((p) => !p.phoneOnly).map((p) => ({ ...p.desktop }));
  }
  function save() {
    if (!ready || destroyed || changing) return;
    state.panels = layout();
    state.phone.activeId = active;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
    }
  }
  function capture(arranged = false) {
    if (changing || mode !== "desktop") return;
    for (const p of panels.values()) {
      if (p.phoneOnly) continue;
      const n = p.el.gridstackNode;
      if (!n) continue;
      const y = arranged ? p.desktop.y : p.projectedY === void 0 ? n.y : p.desktop.y + n.y - p.projectedY;
      Object.assign(p.desktop, { x: n.x, y, w: n.w });
      p.projectedY = n.y;
      if (!p.collapsed) p.desktop.h = n.h;
    }
  }
  function fresh(p) {
    const s = p.snapshot, hide = !!p.noStatus || s.state === "idle";
    p.fresh.hidden = hide;
    p.fresh.textContent = hide ? "" : freshnessText(s.state, s.age, i18n);
    if (hide) delete p.fresh.dataset.state;
    else p.fresh.dataset.state = s.state;
  }
  const mapListeners = /* @__PURE__ */ new Map(), revisions = /* @__PURE__ */ new Map();
  function snapshot(type) {
    if (type === "ready") return mapAPI.readyInfo;
    if (type === "select") return { entity: selected };
    if (type === "time") return { t: clock.time };
    return void 0;
  }
  const mapAPI = { get readyInfo() {
    const info = map()?.host.readyInfo;
    return info ? structuredClone(info) : null;
  }, send: (type, payload2) => map()?.host.send(type, payload2) ?? false, subscribe(type, fn) {
    if (!["ready", "select", "time", "hover", "viewChanged", "appEvent"].includes(type) || typeof fn !== "function") throw new TypeError("Invalid map subscription");
    let listeners = mapListeners.get(type);
    if (!listeners) mapListeners.set(type, listeners = /* @__PURE__ */ new Set());
    const listener = { fn };
    listeners.add(listener);
    const revision = revisions.get(type);
    queueMicrotask(() => {
      if (destroyed || !listeners.has(listener) || revision !== revisions.get(type)) return;
      const value = snapshot(type);
      if (value != null) fn(structuredClone(value));
    });
    return () => listeners.delete(listener);
  } };
  function emitMap(type, payload2) {
    revisions.set(type, (revisions.get(type) || 0) + 1);
    for (const { fn } of mapListeners.get(type) || []) fn(structuredClone(payload2));
  }
  function context(p) {
    return { map: { get readyInfo() {
      return mapAPI.readyInfo;
    }, send: mapAPI.send, subscribe: (type, fn) => {
      const stop = mapAPI.subscribe(type, fn);
      p.stops.push(stop);
      return stop;
    } }, get locale() {
      return i18n.locale;
    }, t: i18n.t, entry: p.entry, videoUrl: new URL(manifest.videoUrl || "./video.html", base).href, getSelectedEntity: () => selected, requestFocus: () => focus(p.id), focusEntity: (id) => {
      select({ id, label: id, type: "station", properties: {} });
      map()?.host.send("flyTo", { target: { id } });
      map()?.host.send("highlight", { ids: [id] });
    }, subscribe: (id, fn) => {
      const stop = hub.subscribe(id, fn);
      p.stops.push(stop);
      return stop;
    } };
  }
  let mapTime = false, timeTimer, lastSentAt = -Infinity, lastSentTime = null, pendingTime;
  function sendClock() {
    clearTimeout(timeTimer);
    timeTimer = void 0;
    const host = map()?.host;
    if (!host?.ready || !host.capabilities.has("setTime") || pendingTime === lastSentTime) return;
    lastSentTime = pendingTime;
    lastSentAt = performance.now();
    host.send("setTime", { t: pendingTime });
  }
  function clockMoved(t) {
    if (mapTime) return;
    pendingTime = t;
    const wait = 100 - (performance.now() - lastSentAt);
    if (wait <= 0) sendClock();
    else if (!timeTimer) timeTimer = setTimeout(sendClock, wait);
  }
  function map() {
    return [...panels.values()].find((p) => p.type === "map");
  }
  function select(entity2) {
    selected = entity2;
    let p = [...panels.values()].find((p2) => p2.type === "selection");
    if (!p) p = addPanel({ id: "selection", type: "selection" });
    if (!p) return entity2;
    p.snapshot = { records: [], state: entity2 ? "selected" : "idle", age: null };
    p.def.update(p.view, p.snapshot);
    fresh(p);
    map()?.host.send("highlight", { ids: entity2 ? [entity2.id] : [] });
    if (p.collapsed) doAction(p, "collapse");
    else present();
    save();
    focus(p.id);
    return entity2;
  }
  function ordered() {
    const list = [...panels.values()].filter((p) => p.type !== "map").sort((a, b) => a.desktop.y - b.desktop.y || a.desktop.x - b.desktop.x);
    const order = mode === "phone" ? state.phone.order : mode === "compact" ? compactOrder : null;
    return order ? list.sort((a, b) => (order.indexOf(a.id) < 0 ? order.length : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? order.length : order.indexOf(b.id))) : list;
  }
  function focus(id, { reveal = true } = {}) {
    const p = panels.get(id);
    if (!p) return;
    if (mode === "phone" && p.type !== "map") {
      if (maximized && maximized !== p) maximized = null;
      active = id;
      if (reveal) state.phone.deckVisible = true;
      present();
      gridEl.scrollTo({ left: p.el.offsetLeft - 12, behavior: "auto" });
    }
    save();
    if (mode !== "phone" || state.phone.deckVisible) p.header.focus({ preventScroll: true });
  }
  function navigate(direction) {
    const list = ordered(), index = list.findIndex((p2) => p2.id === active);
    const p = list[clamp(index + direction, 0, list.length - 1)];
    if (p) focus(p.id);
  }
  function askUI(p) {
    const box = el("section", null, "panel-ai"), askButton = button("ask", () => {
      form.hidden = !form.hidden;
      if (!form.hidden) input.focus();
    }, "ask-ai"), form = el("form", null, "ask-form"), input = el("input"), presetButton = button("askPreset", () => {
      input.value = i18n.t("askPreset");
      run();
    }, "question-preset"), send = el("button", i18n.t("send")), status = el("div", null, "ai-status"), answer = el("pre", null, "ai-answer"), grounding = el("div", null, "grounding");
    input.name = "question";
    input.maxLength = 2e3;
    input.required = true;
    input.value = i18n.t("askPreset");
    input.setAttribute("aria-label", i18n.t("askPlaceholder"));
    send.type = "submit";
    status.setAttribute("role", "status");
    answer.tabIndex = 0;
    form.hidden = p.type !== "chat";
    form.append(input, send, presetButton);
    box.append(askButton, form, status, answer, grounding);
    p.body.append(box);
    p.ai = { box, askButton, input, presetButton, send, status, answer, grounding };
    async function run() {
      if (!input.value.trim()) return;
      p.abort?.abort();
      const abort = p.abort = new AbortController();
      answer.textContent = "";
      grounding.textContent = "";
      delete grounding.dataset.status;
      status.textContent = i18n.t("thinking");
      send.disabled = true;
      const rows = p.snapshot.records, windowRows = rows.slice(-200);
      const request = { panelType: p.type, description: { ...panelDescription(p.def, p.snapshot), history: { availableRecords: rows.length, sentRecords: windowRows.length, windowStart: windowRows[0]?.timestamp || null, windowEnd: windowRows.at(-1)?.timestamp || null, partial: rows.length > windowRows.length || !windowRows.length || Date.now() - Date.parse(windowRows[0].timestamp) < 6e5 } }, recentWindow: windowRows, selectedEntity: selected, question: input.value.trim(), language: i18n.locale };
      try {
        await askPanel({ url: new URL(manifest.aiPath || "ai/ask", apiBase), request, signal: abort.signal, token, onEvent(type, d) {
          if (abort.signal.aborted) return;
          if (type === "queued") status.textContent = `${i18n.t("queued")} \xB7 ${d.position}`;
          if (type === "started") status.textContent = i18n.t(d.fake ? "fake" : "started");
          if (type === "delta") answer.textContent += d.text || "";
          if (type === "done") {
            answer.textContent = d.text;
            grounding.textContent = i18n.t(d.grounding.status);
            grounding.dataset.status = d.grounding.status;
            status.textContent = d.fake ? i18n.t("fake") : i18n.t("started");
            p.lastAnswer = d;
          }
          if (type === "error") status.textContent = i18n.t(aiErrorKey(d.code));
        } });
      } finally {
        send.disabled = false;
        if (p.abort === abort) p.abort = null;
      }
    }
    form.onsubmit = (e) => {
      e.preventDefault();
      run();
    };
  }
  function mount(raw) {
    const e = entry(raw);
    if (!valid(e) || panels.has(e.id)) return panels.get(e.id);
    const def = types[e.type], item = el("div", null, `grid-stack-item panel-${e.type === "map" ? "map" : "content"}`);
    item.dataset.panel = e.id;
    item.setAttribute("gs-id", e.id);
    const card = el("article", null, "grid-stack-item-content panel-card"), header = el("header", null, "panel-header"), title = el("h2"), freshness = el("span", null, "freshness"), actions = el("details", null, "panel-menu"), summary2 = el("summary", "\u22EF"), menu = el("div", null, "panel-actions"), body = el("div", null, "panel-body"), content = el("div", null, "panel-content");
    header.tabIndex = 0;
    summary2.setAttribute("aria-label", i18n.t("menu"));
    actions.append(summary2, menu);
    header.append(title, freshness, actions);
    body.append(content);
    card.append(header, body);
    item.append(card);
    const desktop = { id: e.id, type: e.type, x: e.x ?? 0, y: e.y ?? 0, w: e.w ?? e.defaultSize?.w ?? def?.defaultSize?.w ?? 4, h: e.h ?? e.defaultSize?.h ?? def?.defaultSize?.h ?? 3, collapsed: !!e.collapsed };
    const p = { id: e.id, type: e.type, entry: e, desktop, def, el: item, card, header, title, fresh: freshness, body, content, menu, actions, collapsed: !!e.collapsed, stops: [], snapshot: { records: [], state: e.type === "selection" ? selected ? "selected" : "idle" : "connecting", age: null } };
    panels.set(e.id, p);
    const labels = { close: "close", collapse: "collapse", maximize: "maximize", "move-earlier": "moveEarlier", "move-later": "moveLater", "move-left": "moveLeft", "move-right": "moveRight", "move-up": "moveUp", "move-down": "moveDown", grow: "grow", shrink: "shrink" };
    for (const [action, label2] of Object.entries(labels)) {
      const b = button(label2, () => {
        doAction(p, action);
        if (action !== "close") actions.open = false;
      });
      b.dataset.action = action;
      menu.append(b);
    }
    actions.ontoggle = () => {
      if (actions.open) {
        for (const other of panels.values()) if (other !== p) other.actions.open = false;
      }
      item.classList.toggle("menu-open", actions.open);
    };
    header.prepend(el("span", e.icon || def?.icon || "\u2316", "panel-icon"));
    const close = button("close", () => doAction(p, "close"), "panel-close");
    close.textContent = "\xD7";
    close.setAttribute("aria-label", i18n.t("close"));
    header.append(close);
    header.onkeydown = (ev) => {
      if (ev.target !== header) return;
      const dir = { ArrowLeft: "move-left", ArrowRight: "move-right", ArrowUp: "move-up", ArrowDown: "move-down" }[ev.key];
      if (dir) {
        ev.preventDefault();
        doAction(p, mode !== "desktop" ? ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? "move-earlier" : "move-later" : ev.shiftKey ? ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? "shrink" : "grow" : dir);
      }
    };
    gridEl.append(item);
    grid.makeWidget(item, { ...desktop, minW: 2, minH: 2 });
    if (e.type === "map") {
      card.insertBefore(replayControls, body);
      const frame = el("iframe", null, "map-frame");
      frame.title = i18n.t("map");
      frame.src = mapUrl.href;
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      content.append(frame);
      p.host = new MapHost(frame, { onLoad: () => {
        p.snapshot.state = "connecting";
        fresh(p);
        revisions.set("ready", (revisions.get("ready") || 0) + 1);
      }, onReady: (info) => {
        p.snapshot.state = "ready";
        fresh(p);
        lastSentTime = null;
        pendingTime = clock.time;
        clockMoved(clock.time);
        emitMap("ready", info);
      }, onSelect: (entity2) => {
        select(entity2);
        emitMap("select", { entity: entity2 });
      }, onHover: (entity2) => emitMap("hover", { entity: entity2 }), onViewChanged: (view) => emitMap("viewChanged", { view }), onAppEvent: (payload2) => emitMap("appEvent", payload2), onTime: (t) => {
        if (!clock.paused || clock.time === t) return;
        clearTimeout(timeTimer);
        timeTimer = void 0;
        mapTime = true;
        try {
          clock.seek(t);
        } finally {
          mapTime = false;
          pendingTime = clock.time;
        }
      } });
      p.host.send("setTheme", { theme: "dark" });
    } else {
      if (!state.phone.order.includes(p.id)) state.phone.order.push(p.id);
      const source = el("small", i18n.t(manifest.streams?.[e.stream]?.transport === "replay" ? "replay" : "mocked"), "source-label");
      content.append(source);
      p.renderTarget = el("div", null, "panel-render");
      content.append(p.renderTarget);
      p.view = def.render(p.renderTarget, context(p));
      def.update?.(p.view, p.snapshot);
      askUI(p);
    }
    const streams = e.stream ? [e.stream] : Array.isArray(def?.streams) ? def.streams : [];
    p.noStatus = !streams.length && e.type !== "map" && e.type !== "selection";
    for (const stream of streams) p.stops.push(hub.subscribe(stream, (s) => {
      p.snapshot = s;
      fresh(p);
      def?.update?.(p.view, s);
    }));
    fresh(p);
    label(p);
    return p;
  }
  function label(p) {
    p.title.textContent = p.entry.titleKey ? i18n.t(p.entry.titleKey) : p.entry.title || p.def?.title || i18n.t(p.id);
    for (const b of p.menu.querySelectorAll("[data-action]")) {
      const action = b.dataset.action;
      if (action === "collapse") b.dataset.label = p.collapsed ? "expand" : "collapse";
      if (action === "maximize") b.dataset.label = maximized === p ? "restore" : "maximize";
      b.textContent = i18n.t(b.dataset.label);
      b.hidden = mode === "phone" && p.type === "map" || (mode === "desktop" ? ["move-earlier", "move-later"].includes(action) : ["move-left", "move-right", "move-up", "move-down", "grow", "shrink"].includes(action));
      if (["move-earlier", "move-later"].includes(action)) {
        const list = ordered(), index = list.indexOf(p);
        b.disabled = action === "move-earlier" ? index <= 0 : index < 0 || index === list.length - 1;
      }
    }
    p.header.setAttribute("aria-expanded", String(!p.collapsed));
    p.header.setAttribute("aria-label", p.title.textContent);
  }
  function present() {
    const list = ordered();
    if (!list.some((p) => p.id === active)) active = list[0]?.id || null;
    root.classList.toggle("deck-stowed", !state.phone.deckVisible || !list.length);
    for (const p of panels.values()) {
      p.collapsed = maximized === p ? false : mode === "phone" ? p.type === "map" ? false : !!state.phone.collapsed[p.id] : mode === "compact" ? !!compactCollapsed[p.id] : p.desktop.collapsed;
      p.body.hidden = p.collapsed;
      p.el.classList.toggle("is-collapsed", p.collapsed);
      p.el.classList.toggle("is-maximized", maximized === p);
      p.el.classList.toggle("phone-only", !!p.phoneOnly);
      p.el.style.order = p.type === "map" ? "-1" : String(list.indexOf(p));
      label(p);
    }
    position.textContent = list.length ? `${list.findIndex((p) => p.id === active) + 1} / ${list.length} \xB7 ${panels.get(active)?.title.textContent || ""}` : i18n.t("noPanels");
    previous.textContent = "\u2039";
    next.textContent = "\u203A";
    previous.setAttribute("aria-label", i18n.t("previous"));
    next.setAttribute("aria-label", i18n.t("next"));
    previous.disabled = !list.length || list[0]?.id === active;
    next.disabled = !list.length || list.at(-1)?.id === active;
    stow.dataset.label = !list.length ? "add" : state.phone.deckVisible ? "showMap" : "showPanels";
    stow.textContent = i18n.t(stow.dataset.label);
  }
  function arrange() {
    changing = true;
    grid.batchUpdate();
    for (const p of panels.values()) {
      if (p.phoneOnly) continue;
      const d = p.desktop;
      grid.update(p.el, { x: d.x, y: d.y, w: d.w, h: d.collapsed ? p.type === "map" && manifest.clock?.controls !== false ? 2 : 1 : d.h, minH: d.collapsed ? 1 : 2 });
    }
    grid.batchUpdate(false);
    changing = false;
    present();
    capture(true);
    if (!map() && manifest.clock?.controls !== false) root.append(replayControls);
  }
  function dispose(p) {
    p.abort?.abort();
    p.stops.forEach((stop) => stop());
    p.host?.destroy();
    p.def?.dispose?.(p.view);
    if (maximized === p) maximized = null;
  }
  function doAction(p, action) {
    if (action === "close") {
      if (p.type === "map") {
        p.phoneOnly = true;
        if (maximized === p) maximized = null;
        changing = true;
        grid.removeWidget(p.el, false);
        changing = false;
        capture();
        present();
        save();
        return;
      }
      const list = ordered(), index = list.indexOf(p);
      dispose(p);
      changing = true;
      grid.removeWidget(p.el);
      changing = false;
      panels.delete(p.id);
      capture();
      state.phone.order = state.phone.order.filter((id) => id !== p.id);
      delete state.phone.collapsed[p.id];
      if (active === p.id) active = list[index + 1]?.id || list[index - 1]?.id || null;
      present();
      save();
      if (mode === "phone" && active) focus(active, { reveal: false });
      else managerSummary.focus();
      return;
    }
    if (action === "collapse") {
      if (mode === "phone" && p.type === "map") return;
      if (maximized === p) maximized = null;
      if (mode === "phone") state.phone.collapsed[p.id] = !p.collapsed;
      else if (mode === "compact") compactCollapsed[p.id] = !p.collapsed;
      else p.desktop.collapsed = !p.collapsed;
      arrange();
      save();
      return;
    }
    if (action === "maximize") {
      if (mode === "phone" && p.type === "map") return;
      maximized = maximized === p ? null : p;
      present();
      return;
    }
    if (action === "move-earlier" || action === "move-later") {
      const list = ordered(), index = list.indexOf(p), other = list[index + (action === "move-earlier" ? -1 : 1)];
      if (!other) return;
      if (mode === "phone") {
        const a = state.phone.order.indexOf(p.id), b = state.phone.order.indexOf(other.id);
        [state.phone.order[a], state.phone.order[b]] = [state.phone.order[b], state.phone.order[a]];
      } else {
        compactOrder = list.map((p2) => p2.id);
        const otherIndex = list.indexOf(other);
        [compactOrder[index], compactOrder[otherIndex]] = [compactOrder[otherIndex], compactOrder[index]];
      }
      present();
      save();
      focus(p.id);
      return;
    }
    const d = { "move-left": [-1, 0, 0, 0], "move-right": [1, 0, 0, 0], "move-up": [0, -1, 0, 0], "move-down": [0, 1, 0, 0], grow: [0, 0, 1, 1], shrink: [0, 0, -1, -1] }[action];
    if (d && mode === "desktop") {
      const n = p.el.gridstackNode, w = clamp(n.w + d[2], 2, 12);
      grid.update(p.el, { x: clamp(n.x + d[0], 0, 12 - w), y: clamp(n.y + d[1], 0, 100), w, h: clamp(n.h + d[3], p.collapsed ? 1 : 2, 30) });
      capture();
      save();
    }
  }
  function addPanel(raw) {
    const existing = panels.get(raw.id);
    if (existing) {
      if (existing.phoneOnly) {
        existing.phoneOnly = false;
        changing = true;
        grid.makeWidget(existing.el, { ...existing.desktop, minW: 2, minH: 2 });
        changing = false;
        arrange();
      }
      present();
      return existing;
    }
    changing = true;
    const p = mount({ ...raw, x: 0, y: Math.max(0, ...layout().map((p2) => p2.y + p2.h)) });
    changing = false;
    if (ready) arrange();
    return p;
  }
  function reset() {
    ready = false;
    changing = true;
    clearTimeout(deckSaveTimer);
    clearTimeout(timeTimer);
    maximized = null;
    selected = null;
    compactOrder = null;
    compactCollapsed = {};
    try {
      clearLayout(localStorage, manifest.id);
    } catch {
    }
    for (const p of panels.values()) {
      dispose(p);
      grid.removeWidget(p.el);
      p.el.remove();
    }
    panels.clear();
    state = defaultLayout(options);
    active = state.phone.activeId;
    for (const e of state.panels) mount(e);
    ensurePhoneMap();
    changing = false;
    arrange();
    ready = true;
    setLocale(i18n.locale);
    save();
    if (mode === "phone" && active) focus(active, { reveal: false });
  }
  function ensurePhoneMap() {
    if (mode !== "phone" || map()) return;
    const e = [...catalogue, ...options.preset].find((p) => p.type === "map");
    if (e) {
      const p = mount({ ...e, x: 0, y: 0 });
      p.phoneOnly = true;
      grid.removeWidget(p.el, false);
    }
  }
  function shield(on) {
    root.classList.toggle("is-dragging", on);
    for (const f of root.querySelectorAll("iframe")) f.style.pointerEvents = on ? "none" : "";
  }
  function setLocale(v) {
    i18n.setLocale(v);
    root.lang = i18n.locale;
    document.documentElement.lang = i18n.locale;
    summary.textContent = i18n.t("settings");
    for (const b of top.querySelectorAll("[data-label]")) b.textContent = i18n.t(b.dataset.label);
    for (const o of catalog.options) o.textContent = i18n.t(byId.get(o.value)?.titleKey || o.value);
    for (const p of panels.values()) {
      label(p);
      fresh(p);
      if (p.renderTarget && p.def === builtins[p.type]) {
        p.def.dispose?.(p.view);
        p.renderTarget.replaceChildren();
        p.view = p.def.render(p.renderTarget, context(p));
        p.def.update?.(p.view, p.snapshot);
      }
      if (p.ai) {
        p.ai.askButton.textContent = i18n.t("ask");
        p.ai.send.textContent = i18n.t("send");
        p.ai.presetButton.textContent = i18n.t("askPreset");
        p.ai.input.value = i18n.t("askPreset");
      }
    }
    range.setAttribute("aria-label", i18n.t("seek"));
    rate.setAttribute("aria-label", i18n.t("speed"));
    stepBack.setAttribute("aria-label", i18n.t("stepBack"));
    stepForward.setAttribute("aria-label", i18n.t("stepForward"));
    renderTime(clock.time);
    present();
  }
  locale.onchange = () => setLocale(locale.value);
  function timeText(t) {
    const format = manifest.clock?.labelFormat || "seconds";
    if (typeof format === "function") return String(format(t));
    if (format === "hh:mm" || format === "hh:mm:ss") {
      const sec = Math.floor(t / 1e3), parts = [Math.floor(sec / 3600), Math.floor(sec / 60) % 60];
      if (format === "hh:mm:ss") parts.push(sec % 60);
      return parts.map((x) => String(x).padStart(2, "0")).join(":");
    }
    return `${Math.round(t / 1e3)}s`;
  }
  function renderTime(t) {
    range.value = t;
    timeLabel.textContent = `${i18n.t("replay")} ${timeText(t)}`;
    play.textContent = i18n.t(clock.paused ? "play" : "pause");
    play.dataset.label = clock.paused ? "play" : "pause";
  }
  clock.subscribe((t) => {
    clockMoved(t);
    renderTime(t);
    emitMap("time", { t });
  });
  grid.on("change", () => {
    capture();
    save();
  });
  grid.on("dragstart resizestart", () => shield(true));
  grid.on("dragstop resizestop", () => {
    shield(false);
    capture();
    save();
  });
  const cancel = () => shield(false);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  function phoneMode() {
    const nextMode = phone.matches ? "phone" : compact.matches ? "compact" : "desktop";
    if (nextMode !== mode) {
      clearTimeout(deckSaveTimer);
      capture();
      maximized = null;
      mode = nextMode;
      root.dataset.mode = mode;
      changing = true;
      ensurePhoneMap();
      changing = false;
      arrange();
    }
    manager.open = mode !== "phone";
    grid.enableMove(mode === "desktop");
    grid.enableResize(mode === "desktop");
    shield(false);
    present();
    if (mode === "phone" && active) {
      const p = panels.get(active);
      if (p) gridEl.scrollTo({ left: p.el.offsetLeft - 12, behavior: "auto" });
    }
  }
  phone.addEventListener("change", phoneMode);
  compact.addEventListener("change", phoneMode);
  gridEl.addEventListener("scroll", () => {
    if (mode !== "phone" || !phone.matches || changing) return;
    clearTimeout(deckSaveTimer);
    deckSaveTimer = setTimeout(() => {
      if (mode !== "phone" || !phone.matches || changing) return;
      const visible = ordered().sort((a, b) => Math.abs(a.el.offsetLeft - 12 - gridEl.scrollLeft) - Math.abs(b.el.offsetLeft - 12 - gridEl.scrollLeft))[0];
      if (visible) {
        active = visible.id;
        present();
        save();
      }
    }, 180);
  });
  changing = true;
  for (const p of state.panels) mount(p);
  ensurePhoneMap();
  changing = false;
  arrange();
  ready = true;
  setLocale(i18n.locale);
  phoneMode();
  save();
  return { hub, clock, map: mapAPI, get layout() {
    return layout();
  }, select, focus, save, reset, destroy() {
    clearTimeout(timeTimer);
    mapListeners.clear();
    clearTimeout(deckSaveTimer);
    save();
    destroyed = true;
    for (const p of panels.values()) dispose(p);
    panels.clear();
    grid.destroy(false);
    hub.destroy();
    clock.destroy();
    phone.removeEventListener("change", phoneMode);
    compact.removeEventListener("change", phoneMode);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    root.remove();
  } };
}
export {
  MapHost,
  SimulationClock,
  StreamHub,
  askPanel,
  builtins,
  createApp,
  createI18n,
  formatAge,
  panelDescription,
  resolveAPI,
  supportedLocales,
  translations
};
/*! Bundled license information:

gridstack/dist/gridstack.js:
  (*!
   * GridStack 13.3.0
   * https://gridstackjs.com/
   *
   * Copyright (c) 2021-2025  Alain Dumesny
   * see root license https://github.com/gridstack/gridstack.js/tree/master/LICENSE
   *)
*/
