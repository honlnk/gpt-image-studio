/** generation 域词条。 */
export default {
  "mode": {
    "maskEdit": "局部编辑",
    "referenceEdit": "引用图片编辑",
    "textToImage": "文字生成图片"
  },
  "continueWithReferenceDefault": "基于引用图片继续编辑。",
  "interrupted": "生成中断，请重试。",
  "failed": "生成失败，请重试。",
  "partialFailure": {
    "pending": "{count} 张生成失败，其余仍在继续。",
    "kept": "{count} 张生成失败，已保留成功结果。"
  },
  "result": {
    "prefixGenerated": "已生成",
    "prefixFromReference": "已基于引用图生成",
    "countPlural": "{prefix} {count} 张图片。",
    "countSingular": "{prefix}一张图片。"
  },
  "pending": {
    "textPlural": "正在生成 {count} 张图片。",
    "textSingular": "正在生成图片。",
    "editPlural": "正在基于引用图片生成 {count} 张编辑结果。",
    "editSingular": "正在基于引用图片生成编辑结果。"
  },
  "continued": {
    "textPlural": "正在继续生成 {count} 张图片。",
    "textSingular": "正在继续生成图片。",
    "editPlural": "正在继续生成 {count} 张编辑结果。",
    "editSingular": "正在继续生成编辑结果。"
  },
  "regenerating": {
    "image": "正在重新生成图片。",
    "editResult": "正在重新生成编辑结果。"
  },
  "pendingResult": {
    "generatedPart": "已生成 {count} 张，",
    "remaining": "还有 {count} 张{noun}正在生成。",
    "nounImage": "图片",
    "nounEditResult": "编辑结果"
  },
  "editError": {
    "referenceMissing": "引用图片不存在，请重新添加引用。",
    "referenceUnreadable": "无法读取引用图片文件，请重新生成或导入图片。",
    "payloadTooLarge": "引用图片总大小为 {total}MB，超过 20MB 上限。请减少图片数量或压缩图片后重试。",
    "maskUnreadable": "无法读取编辑遮罩文件，请重新选择编辑区域。",
    "maskNotPng": "编辑遮罩必须是 PNG 文件，请重新选择编辑区域。",
    "sourceNotInReferences": "编辑源图不在当前引用列表中，请重新选择继续编辑。",
    "maskMissing": "编辑遮罩不存在，请重新选择编辑区域。",
    "sourceMissing": "缺少编辑源图，无法使用局部编辑。",
    "sourceUnreadable": "无法读取编辑源图，请重新引用图片。",
    "maskSizeMismatch": "编辑遮罩尺寸与源图不一致，请重新选择编辑区域。"
  },
  "companion": {
    "httpError": "请求失败：HTTP {status}",
    "httpErrorWithDetail": "请求失败：HTTP {status}：{detail}",
    "missingImageData": "响应中没有 data[0].b64_json。"
  }
};
