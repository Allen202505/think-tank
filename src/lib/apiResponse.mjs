export async function readApiResponse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    const gatewayError = (res.status >= 502 && res.status <= 504) || /<!DOCTYPE|<html|error code:\s*5\d\d|bad gateway/i.test(text);
    throw new Error(gatewayError
      ? '分析服务暂时不可用，请稍后重试'
      : `分析服务返回异常（HTTP ${res.status}），请稍后重试`);
  }
}
