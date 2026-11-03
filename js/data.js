/**
 * 生词库 —— 创世记 1:1–2 (CEV)
 * 17 个重点生词，含音标、音节拆分、释义、例句、记忆提示、易混干扰项。
 *
 * 设计要点：
 * 1. cnDistractors / enDistractors 全部人工策划，优先取「形近 / 义近 / 上下文同现」的词，
 *    逼出真实辨析，而不是靠排除法蒙对。
 * 2. 例句尽量取自 CEV 原文，让词汇始终连着经文语境。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VOCAB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var VOCAB = [
    {
      id: 'beginning',
      word: 'beginning',
      phonetic: '/bɪˈɡɪnɪŋ/',
      syllables: ['be', 'gin', 'ning'],
      pos: 'n.',
      meaning: '开始，起初',
      example: 'In the beginning God created the heavens and the earth.',
      exampleZh: '起初，神创造了诸天和大地。',
      tip: 'begin 的名词形式。固定搭配 "In the ~" = 起初、最初。',
      note: '注意与 heaven / heavens 的区分：开头是 b，不是 h。',
      cnDistractors: ['创造，创作', '荒芜的，贫瘠的，没有生命的', '黑暗'],
      enDistractors: ['created', 'heaven', 'move']
    },
    {
      id: 'god',
      word: 'God',
      phonetic: '/ɡɑːd/',
      syllables: ['God'],
      pos: 'n.',
      meaning: '上帝，神',
      example: 'But the Spirit of God was moving over the water.',
      exampleZh: '但神的灵在水面上运行。',
      tip: '宗教语境中的 "God" 首字母永远大写；指一般神祇时也常大写。',
      note: '与 Spirit（灵、圣灵）易混：本句中 God 是施动者，Spirit 才是运行的那一位。',
      cnDistractors: ['灵，圣灵', '移动，运动', '咆哮的，轰鸣的'],
      enDistractors: ['Spirit', 'life', 'earth']
    },
    {
      id: 'heaven',
      word: 'heaven',
      phonetic: '/ˈhevən/',
      syllables: ['heav', 'en'],
      pos: 'n.',
      meaning: '天堂，天',
      example: 'God created heaven and earth.',
      exampleZh: '神创造了天地。',
      tip: '单数形式，偏「一个天 / 天堂」；重音在第一个音节。',
      note: '与 heavens（诸天）只差一个 s：本段经文用的是复数 heavens。',
      cnDistractors: ['诸天，天空', '地球，大地', '黑暗'],
      enDistractors: ['heavens', 'earth', 'darkness']
    },
    {
      id: 'heavens',
      word: 'heavens',
      phonetic: '/ˈhevənz/',
      syllables: ['heav', 'ens'],
      pos: 'n. pl.',
      meaning: '诸天，天空',
      example: 'In the beginning God created the heavens and the earth.',
      exampleZh: '起初，神创造了诸天和大地。',
      tip: '常与 earth 连用：the heavens and the earth（诸天与大地）。',
      note: '复数形式，表示「诸天」；单数 heaven 指「一个天 / 天堂」。',
      cnDistractors: ['天堂，天', '海洋，大海', '灵，圣灵'],
      enDistractors: ['heaven', 'ocean', 'Spirit']
    },
    {
      id: 'earth',
      word: 'earth',
      phonetic: '/ɜːrθ/',
      syllables: ['earth'],
      pos: 'n.',
      meaning: '地球，大地',
      example: 'The earth was barren, with no form of life.',
      exampleZh: '大地一片荒芜，毫无生命的形态。',
      tip: '本段 earth 指「大地 / 地」，与 heavens（诸天）相对成对出现。',
      note: '与 ocean（海洋）对照：上天下地、前后相承，同一段经文中常成对出现。',
      cnDistractors: ['海洋，大海', '诸天，天空', '黑暗'],
      enDistractors: ['ocean', 'heavens', 'life']
    },
    {
      id: 'create',
      word: 'create',
      phonetic: '/kriˈeɪt/',
      syllables: ['cre', 'ate'],
      pos: 'v.',
      meaning: '创造，创作',
      example: 'God creates the heavens and the earth.',
      exampleZh: '神创造诸天和大地。',
      tip: '原形动词；名词是 creation。重音在第二个音节 -ate。',
      note: '与 created（过去式/过去分词）辨析：本句用现在时 create。',
      cnDistractors: ['创造了', '开始，起初', '移动，运动'],
      enDistractors: ['created', 'beginning', 'moving']
    },
    {
      id: 'created',
      word: 'created',
      phonetic: '/kriˈeɪtɪd/',
      syllables: ['cre', 'at', 'ed'],
      pos: 'v. (past)',
      meaning: '创造了（create 的过去式）',
      example: 'In the beginning God created the heavens and the earth.',
      exampleZh: '起初，神创造了诸天和大地。',
      tip: 'create + -ed。本段经文用过去式 created，描述已经完成的动作。',
      note: '句尾的 created 是过去式；注意别和 create（现在时）搞反。',
      cnDistractors: ['创造，创作', '正在移动', '形状，形态，形式'],
      enDistractors: ['create', 'moving', 'form']
    },
    {
      id: 'barren',
      word: 'barren',
      phonetic: '/ˈbærən/',
      syllables: ['bar', 'ren'],
      pos: 'adj.',
      meaning: '荒芜的，贫瘠的，没有生命的',
      example: 'The earth was barren, with no form of life.',
      exampleZh: '大地一片荒芜，毫无生命的形态。',
      tip: 'barr- 双写 r。重音在第一个音节 -bar-。形容土地不毛、毫无生机。',
      note: '与 dark（黑暗）都是形容词，但 barren 说的是「不毛、无生机」，不是「黑」。',
      cnDistractors: ['黑暗', '咆哮的，轰鸣的', '海洋，大海'],
      enDistractors: ['darkness', 'life', 'ocean']
    },
    {
      id: 'form',
      word: 'form',
      phonetic: '/fɔːrm/',
      syllables: ['form'],
      pos: 'n.',
      meaning: '形状，形态，形式',
      example: 'The earth was barren, with no form of life.',
      exampleZh: '大地一片荒芜，毫无形态的生命。',
      tip: '本段 "no form of life" = 没有任何形态的生命。作名词时也指「表格」。',
      note: '与 life（生命）连用构成短语 "form of life"（生命的形态）。',
      cnDistractors: ['生命，生活', '荒芜的，贫瘠的，没有生命的', '开始，起初'],
      enDistractors: ['life', 'created', 'beginning']
    },
    {
      id: 'life',
      word: 'life',
      phonetic: '/laɪf/',
      syllables: ['life'],
      pos: 'n.',
      meaning: '生命，生活',
      example: 'The earth was barren, with no form of life.',
      exampleZh: '大地一片荒芜，没有生命。',
      tip: '不可数名词泛指「生命」时最常见；life 里的 i 与 e 相邻，发 /aɪ/。',
      note: '与 form（形态）连读成 "form of life"，是本段的核心短语。',
      cnDistractors: ['形状，形态，形式', '黑暗', '正在移动'],
      enDistractors: ['form', 'Spirit', 'darkness']
    },
    {
      id: 'ocean',
      word: 'ocean',
      phonetic: '/ˈoʊʃən/',
      syllables: ['o', 'cean'],
      pos: 'n.',
      meaning: '海洋，大海',
      example: 'It was under a roaring ocean covered with darkness.',
      exampleZh: '那是被黑暗笼罩的咆哮海洋之下。',
      tip: '记 -cean = 海（ocean）。本段 ocean 前加 roaring 修饰。',
      note: '与 water（水）辨析：ocean 是「大海洋」，water 泛指「水」。',
      cnDistractors: ['水', '地球，大地', '黑暗'],
      enDistractors: ['water', 'earth', 'heavens']
    },
    {
      id: 'roaring',
      word: 'roaring',
      phonetic: '/ˈrɔːrɪŋ/',
      syllables: ['roar', 'ing'],
      pos: 'adj.',
      meaning: '咆哮的，轰鸣的',
      example: 'It was under a roaring ocean covered with darkness.',
      exampleZh: '那是被黑暗笼罩的咆哮海洋之下。',
      tip: '现在分词形容词（roar + -ing），修饰名词 ocean：咆哮的大海。',
      note: '与 moving（正在移动）同为 -ing 形式，但 roaring 是「声音」，moving 是「动作」。',
      cnDistractors: ['荒芜的，贫瘠的，没有生命的', '黑暗', '正在移动'],
      enDistractors: ['barren', 'darkness', 'moving']
    },
    {
      id: 'darkness',
      word: 'darkness',
      phonetic: '/ˈdɑːrknəs/',
      syllables: ['dark', 'ness'],
      pos: 'n.',
      meaning: '黑暗',
      example: 'It was under a roaring ocean covered with darkness.',
      exampleZh: '那是被黑暗笼罩的咆哮海洋之下。',
      tip: '形容词 dark（黑暗的）+ 名词后缀 -ness。名词记「一种状态」用 -ness。',
      note: '与 barren（荒芜）对照：darkness 讲「光」，barren 讲「生机」。',
      cnDistractors: ['荒芜的，贫瘠的，没有生命的', '咆哮的，轰鸣的', '水'],
      enDistractors: ['barren', 'roaring', 'water']
    },
    {
      id: 'spirit',
      word: 'Spirit',
      phonetic: '/ˈspɪrɪt/',
      syllables: ['Spir', 'it'],
      pos: 'n.',
      meaning: '灵，圣灵',
      example: 'But the Spirit of God was moving over the water.',
      exampleZh: '但神的灵在水面上运行。',
      tip: '本段指「神的灵」，首字母大写。日常义也有「精神、情绪」。',
      note: '与 God 辨析：God 是神本身，Spirit 是祂的灵，二者同句出现。',
      cnDistractors: ['上帝，神', '天堂，天', '生命，生活'],
      enDistractors: ['God', 'heaven', 'life']
    },
    {
      id: 'water',
      word: 'water',
      phonetic: '/ˈwɔːtər/',
      syllables: ['wa', 'ter'],
      pos: 'n.',
      meaning: '水',
      example: 'But the Spirit of God was moving over the water.',
      exampleZh: '但神的灵在水面上运行。',
      tip: '不可数名词。本段 the water = 这水 / 水面。',
      note: '与 ocean（海洋）辨析：water 是物质本身，ocean 是大片水域。',
      cnDistractors: ['海洋，大海', '黑暗', '地球，大地'],
      enDistractors: ['ocean', 'earth', 'darkness']
    },
    {
      id: 'move',
      word: 'move',
      phonetic: '/muːv/',
      syllables: ['move'],
      pos: 'v.',
      meaning: '移动，运动',
      example: 'The Spirit of God moved over the water.',
      exampleZh: '神的灵在水面上运行。',
      tip: '原形动词。u 发长音 /uː/，读「穆」不读「摸」。',
      note: '与 moving（现在分词）辨析：本段经文用 moving。',
      cnDistractors: ['正在移动', '创造，创作', '形状，形态，形式'],
      enDistractors: ['moving', 'create', 'form']
    },
    {
      id: 'moving',
      word: 'moving',
      phonetic: '/ˈmuːvɪŋ/',
      syllables: ['mov', 'ing'],
      pos: 'adj./v.-ing',
      meaning: '正在移动',
      example: 'But the Spirit of God was moving over the water.',
      exampleZh: '但神的灵正在水面上运行。',
      tip: 'move + -ing，现在分词作形容词：正在移动的。',
      note: '与 roaring（咆哮的）同为 -ing 形容词，位置都在名词前。',
      cnDistractors: ['移动，运动', '创造了', '咆哮的，轰鸣的'],
      enDistractors: ['move', 'created', 'roaring']
    }
  ];

  return VOCAB;
});
