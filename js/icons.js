/**
 * Icons —— 统一风格的 SVG 图标库
 *
 * 为什么不用 emoji：
 *   emoji 是系统字体渲染的彩色字形，各平台长相不一（Windows 扁平、
 *   macOS 立体），跟 SVG 线条图标放在一起会明显不协调。
 *   全部改为 inline SVG 后，跨平台一致、能跟随主题色、描边粗细可控。
 *
 * 风格约定：24×24 视框、1.7px 描边、圆头圆角、currentColor 着色。
 * 用法：<span class="ic-wrap" data-icon="download"></span>
 */
(function (global) {
  'use strict';

  var PATHS = {
    // —— 导航/功能 ——
    'chart-bar': '<path d="M4 19V9"/><path d="M9.5 19V5"/><path d="M15 19v-7"/><path d="M20.5 19V3"/>',
    'trend-up': '<path d="M3 17.5 8.5 11l4 3.5L21 4.5"/><path d="M15.5 4.5H21v5.5"/>',
    'book-open': '<path d="M12 6.6C10.4 5.2 8.2 4.6 4.8 4.6c-.6 0-1 .45-1 1v11c0 .6.45 1 1 1 3.3 0 5.5.6 7.2 2.1 1.7-1.5 3.9-2.1 7.2-2.1.55 0 1-.4 1-1V5.6c0-.55-.45-1-1-1-3.4 0-5.6.6-7.2 2Z"/><path d="M12 6.6v13.1"/>',
    'graduation': '<path d="M12 3.5 22 8.5l-10 5-10-5 10-5Z"/><path d="M6 11v5.2c0 .6.4 1 1 1 1.6.6 3.3.9 5 .9s3.4-.3 5-.9c.6 0 1-.4 1-1V11"/><path d="M21 9v5.5"/>',

    // —— 操作 ——
    'download': '<path d="M12 3.5v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
    'copy': '<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-10a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1"/>',
    'close': '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    'check': '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
    'plus': '<path d="M12 5v14"/><path d="M5 12h14"/>',
    'trash': '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5"/><path d="M6.5 6.5 7.4 19a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-12.5"/>',
    'refresh': '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V10h-5.5"/>',
    'upload': '<path d="M12 15.5v-11"/><path d="M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 19.5h15"/>',

    // —— 内容/媒体 ——
    'speaker': '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5Z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    'mic': '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/><path d="M8.5 21h7"/>',
    'lightbulb': '<path d="M9 17.5h6"/><path d="M10 20.5h4"/><path d="M12 3.5a5.5 5.5 0 0 1 3.4 9.8c-.6.5-.9 1.1-.9 1.7v.5h-5v-.5c0-.6-.3-1.2-.9-1.7A5.5 5.5 0 0 1 12 3.5Z"/>',
    'file-text': '<path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z"/><path d="M13.5 3.5V9H19"/><path d="M8.5 13h7"/><path d="M8.5 16.5h4.5"/>',
    'pin': '<path d="M9 3.5h6l-.8 6 3.3 3.2v1.3H6.5V12.7l3.3-3.2L9 3.5Z"/><path d="M12 14v6.5"/>',
    'clipboard': '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3.6A1.6 1.6 0 0 1 11.1 2h1.8a1.6 1.6 0 0 1 1.6 1.6v.9"/><path d="M9.5 11h5"/><path d="M9.5 14.5h5"/>',

    // —— 反馈/状态 ——
    'check-circle': '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2 11 14.7l4.8-4.9"/>',
    'x-circle': '<circle cx="12" cy="12" r="8.5"/><path d="M9.2 9.2 14.8 14.8"/><path d="M14.8 9.2 9.2 14.8"/>',
    'alert': '<path d="M12 4 2.8 20h18.4L12 4Z"/><path d="M12 10v4.5"/><path d="M12 17.4v.1"/>',
    'flame': '<path d="M12 2.8s5.5 4.3 5.5 9.2a5.5 5.5 0 0 1-11 0c0-2 1-3.5 2-4.5 0 1.5 1 2.5 1.8 2.5 1.2 0 1.2-3.6 1.7-7.2Z"/>',
    'pencil': '<path d="M4.5 19.5h3l10-10a2.1 2.1 0 0 0-3-3l-10 10v3Z"/><path d="M13.5 6.5l4 4"/>'
  };

  /**
   * 生成 SVG 标记
   * @param {string} name  图标名
   * @param {string} extra 额外的 class
   */
  function svg(name, extra) {
    var body = PATHS[name];
    if (!body) return '';
    return '<svg class="ic ' + (extra || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + '</svg>';
  }

  function hydrateOne(el) {
    var name = el.getAttribute('data-icon');
    var html = svg(name, el.getAttribute('data-icon-class') || '');
    if (!html) return;
    el.innerHTML = html;
    el.removeAttribute('data-icon');
    el.classList.add('ic-wrap');
  }

  /**
   * 把页面上所有 <span data-icon="xxx"> 替换为 SVG
   * @param {RootNode} root
   */
  function hydrate(root) {
    var nodes = (root || document).querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i++) hydrateOne(nodes[i]);
  }

  /**
   * 自动监听 DOM 变化，把新插入的 [data-icon] 替换掉。
   *
   * 为什么需要：页面大量内容是 innerHTML 动态生成的
   * （答题页、生词表、报告页…），DOM 就绪时跑一次 hydrate 覆盖不到它们。
   */
  function observe() {
    if (typeof global.MutationObserver === 'undefined') return;
    var pending = [];
    var scheduled = false;

    function flush() {
      scheduled = false;
      var list = pending;
      pending = [];
      list.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.hasAttribute && node.hasAttribute('data-icon')) hydrateOne(node);
        if (node.querySelectorAll) {
          var inner = node.querySelectorAll('[data-icon]');
          for (var i = 0; i < inner.length; i++) hydrateOne(inner[i]);
        }
      });
    }

    var observer = new global.MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) pending.push(added[j]);
      }
      if (pending.length && !scheduled) {
        scheduled = true;
        // 合并同一帧内的多次变更，避免重复遍历
        setTimeout(flush, 0);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  var Icons = {
    PATHS: PATHS,
    svg: svg,
    hydrate: hydrate
  };

  global.Icons = Icons;

  // DOM 就绪后自动替换，并开启监听覆盖动态插入的内容
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      hydrate();
      observe();
    });
  } else {
    hydrate();
    observe();
  }
})(window);
