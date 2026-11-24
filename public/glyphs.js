// 果果密语 · 图案字符集
// 26 个"跳舞的小人"风格手绘图案: 由 3 种手臂 × 3 种腿 × 3 种头饰组合而成 (27 种里取 26 种)
// 每个密文字母固定对应一个图案, 同一局里图案与字母一一对应
(function () {
  'use strict';
  const INK = '#2e2318';

  const ARMS = [
    'M20 19 L11 27 M20 19 L29 27',   // 双臂下垂外张
    'M20 19 L12 11 M20 19 L28 11',   // 双臂上举
    'M20 19 L9 19 M20 19 L31 19',    // 双臂平伸
  ];
  const LEGS = [
    'M20 32 L13 45 M20 32 L27 45',   // 站立分开
    'M20 32 L17 46 M20 32 L25 43',   // 一腿抬起
    'M20 32 L16 45 M20 32 L26 41',   // 单腿斜出
  ];
  const HATS = [
    '',                                                   // 无
    '<path d="M14 5 H26 M16 1.5 H24" />',                 // 双横帽
    '<circle cx="14.5" cy="6" r="2.1" /><circle cx="25.5" cy="6" r="2.1" />', // 两侧发髻
  ];

  function glyphSvg(index) {
    const i = ((index % 26) + 26) % 26;
    const arms = i % 3;
    const legs = Math.floor(i / 3) % 3;
    const hat = Math.floor(i / 9) % 3;
    return `<svg viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <g fill="none" stroke="${INK}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="20" cy="9" r="5.2" />
        <path d="M20 14.2 V32" />
        <path d="${ARMS[arms]}" />
        <path d="${LEGS[legs]}" />
        ${HATS[hat]}
      </g>
    </svg>`;
  }

  // 密文字母 -> 图案序号 (固定映射, 不同局里同一个密文字母图案相同)
  function glyphOf(cipherLetter) {
    return glyphSvg(cipherLetter.charCodeAt(0) - 65);
  }

  window.CipherGlyphs = { glyphSvg, glyphOf };
})();
