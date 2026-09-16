# dsh-plugin-branding

[English](README.md) | 中文

品牌文案定制插件：在不拥有官方 locale namespace 的前提下替换 Web 客户端的展示文案。

## 原理

官方 locale registry 对重复 `(namespace, locale)` 注册直接抛错（单一所有者），因此无法通过正规 `register` 覆盖官方词条。本插件对 `LocaleRuntime.prototype.lookup` 安装一次性拦截器——所有翻译调用都收敛到该出口，命中品牌映射表（`src/client/brand-map.ts`，键 `<locale>:<namespace>.<key>`）时返回品牌文案，否则回落原文案。与插件加载顺序无关，中英文均可替换。

## 维护文案

编辑 `src/client/brand-map.ts` 后重新构建本包即可。当前覆盖：

| 键 | zh | en |
|---|---|---|
| `conversation.hero.headline` | 法海问津，为你提供更准确更实时的法律法规~ | Lexford — accurate, up-to-date legal answers |
| `conversation.hero.preview` | 尝鲜版 | Early Access |
| `chat.chat.deepDiving` | 正在深度思考你的需求 | Thinking through your needs... |

## 已知限制

- 依赖 `LocaleRuntime.lookup` 的签名；升级 DSH 版本时需回归验证。
- 仅覆盖文本；无法替换带参数插值的语义（参数替换仍按 `{name}` 原样处理）。
