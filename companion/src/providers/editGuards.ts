/**
 * Provider adapter 共用的编辑前置校验。
 *
 * 各 adapter 的 edit() 入口都有一段"检查参考图数量是否超过 maxImages"的样板，
 * 错误文案也几乎一致（仅 provider 名字不同）。这里收敛成一个工具函数。
 */

/**
 * 校验参考图数量是否在允许范围内。
 *
 * - 0 张：抛 "<providerLabel> 图像编辑需要至少一张参考图。"（qwen/wan 共用文案）
 * - 超过 maxImages：抛 "<providerLabel> 图像编辑最多支持 N 张参考图。"
 * - maxImages 未定义（= undefined）：不校验上限
 *
 * 注意：deepinfra/glm/doubao 的 edit 走 OpenAI 兼容工厂，校验在工厂内部；
 * 此函数主要服务 qwen/wan 这类自实现 edit 的 adapter。
 */
export function assertEditImageCount(
  providerLabel: string,
  imageCount: number,
  maxImages?: number,
): void {
  if (imageCount === 0) {
    throw new Error(`${providerLabel} 图像编辑需要至少一张参考图。`);
  }
  if (maxImages !== undefined && imageCount > maxImages) {
    throw new Error(`${providerLabel} 图像编辑最多支持 ${maxImages} 张参考图。`);
  }
}
