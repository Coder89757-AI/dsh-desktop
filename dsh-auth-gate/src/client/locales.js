/**
 * 中英字典。
 *
 * 只覆盖闸门界面自己的文案。**服务端返回的报错原文不进字典** —— 我们的 HTTP 面
 * 只回稳定原因码（`failure`），文案在这里按码解析，所以服务端怎么改报文都不会
 * 让界面出现英文堆栈或内网地址。
 */

/** locale 命名空间。与 `slots.register({ locale })` 里写的值必须一致。 */
export const NS = 'auth-gate'

export const zh = {
  title: '需要授权',
  subtitle: '请使用统一账号登录后继续。',
  fieldServer: '服务器地址',
  fieldUsername: '用户名',
  fieldPassword: '密码',
  placeholderServer: 'https://auth.example.com',
  submit: '登录',
  submitting: '正在登录…',
  retry: '重新检查',
  checking: '正在校验授权…',
  unreachableTitle: '无法连接授权服务器',
  unreachableHint: '请检查网络或联系管理员。服务器恢复后重新检查即可，无需重新登录。',
  unauthenticatedTitle: '登录已失效',
  expiredHint: '授权已过期，请重新登录。',
  logoutHint: '你已退出登录。',
  logout: '退出登录',
  signedInAs: '当前账号',
  expiresAt: '有效期至',
  memoryOnly: '访问令牌仅保存在内存中，重启应用后需要重新认证。',
  errAddressMissing: '请填写服务器地址。',
  errAddressInvalid: '服务器地址格式不正确。',
  errAddressScheme: '服务器地址必须以 http:// 或 https:// 开头。',
  errAddressInsecure: '出于安全考虑，仅支持 https。如需使用内网 http 地址，请让管理员在插件配置中开启。',
  errAddressUserinfo: '请不要把账号密码写在服务器地址里。',
  errCredentialsMissing: '请填写用户名和密码。',
  errTransport: '无法连接服务器，请检查网络后重试。',
  errRejected: '用户名、密码或授权信息不正确。',
  errMalformed: '服务器返回的数据无法识别，请联系管理员。',
  errServerError: '服务器暂时不可用，请稍后重试。',
  errForbidden: '请求来源不被允许。',
  errBadRequest: '请求格式不正确。',
  errInternal: '插件内部错误，请联系管理员。',
  errUnknown: '登录失败，请重试。',
}

export const en = {
  title: 'Authorization required',
  subtitle: 'Sign in with your directory account to continue.',
  fieldServer: 'Server address',
  fieldUsername: 'Username',
  fieldPassword: 'Password',
  placeholderServer: 'https://auth.example.com',
  submit: 'Sign in',
  submitting: 'Signing in…',
  retry: 'Check again',
  checking: 'Verifying authorization…',
  unreachableTitle: 'Cannot reach the authorization server',
  unreachableHint: 'Check your network or contact your administrator. Retrying after the server recovers needs no new sign-in.',
  unauthenticatedTitle: 'Session expired',
  expiredHint: 'Your authorization expired. Please sign in again.',
  logoutHint: 'You signed out.',
  logout: 'Sign out',
  signedInAs: 'Signed in as',
  expiresAt: 'Valid until',
  memoryOnly: 'The access token lives in memory only; a restart requires re-authentication.',
  errAddressMissing: 'Enter the server address.',
  errAddressInvalid: 'The server address is not a valid URL.',
  errAddressScheme: 'The server address must start with http:// or https://.',
  errAddressInsecure: 'Only https is accepted. Ask your administrator to enable plain http in the plugin config if your intranet host requires it.',
  errAddressUserinfo: 'Do not put credentials inside the server address.',
  errCredentialsMissing: 'Enter a username and password.',
  errTransport: 'Cannot reach the server. Check your network and retry.',
  errRejected: 'The username, password, or authorization was not accepted.',
  errMalformed: 'The server response could not be understood. Contact your administrator.',
  errServerError: 'The server is temporarily unavailable. Try again shortly.',
  errForbidden: 'The request origin is not allowed.',
  errBadRequest: 'Malformed request.',
  errInternal: 'Internal plugin error. Contact your administrator.',
  errUnknown: 'Sign-in failed. Please retry.',
}

/**
 * 把 HTTP 面返回的 `failure` 码解析成字典键。
 *
 * 单点映射：界面拿不到码对应的文案时回落到 `errUnknown`，**绝不把码本身显示给用户**。
 *
 * @param {string|undefined} failure - 原因码。
 * @returns {string} 字典键。
 */
export function failureKey(failure) {
  const known = {
    'address-missing': 'errAddressMissing',
    'address-invalid': 'errAddressInvalid',
    'address-scheme': 'errAddressScheme',
    'address-insecure': 'errAddressInsecure',
    'address-userinfo': 'errAddressUserinfo',
    'credentials-missing': 'errCredentialsMissing',
    transport: 'errTransport',
    rejected: 'errRejected',
    malformed: 'errMalformed',
    'server-error': 'errServerError',
    forbidden: 'errForbidden',
    'bad-request': 'errBadRequest',
    internal: 'errInternal',
  }
  return known[failure] ?? 'errUnknown'
}
