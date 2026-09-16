/** Brand copy overrides, keyed by `<locale>:<namespace>.<key>` and consulted
 * ahead of the shipped dictionaries. Add or edit lines here; no other file
 * needs to change. */

export const BRAND_COPY: ReadonlyMap<string, string> = new Map([
  // zh
  ['zh:conversation.hero.headline', '法海问津，为你提供更准确更实时的法律法规~'],
  ['zh:conversation.hero.preview', '尝鲜版'],
  ['zh:chat.chat.deepDiving', '正在深度思考你的需求'],
  // en
  ['en:conversation.hero.headline', 'Lexford — accurate, up-to-date legal answers'],
  ['en:conversation.hero.preview', 'Early Access'],
  ['en:chat.chat.deepDiving', 'Thinking through your needs...'],
])
