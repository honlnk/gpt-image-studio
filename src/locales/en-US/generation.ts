type ZhGeneration = typeof import("../zh-CN/generation").default;

const generation: ZhGeneration = {
  "mode": {
    "maskEdit": "Mask edit",
    "referenceEdit": "Reference image edit",
    "textToImage": "Text to image"
  },
  "continueWithReferenceDefault": "Continue editing based on the reference images.",
  "interrupted": "Generation interrupted. Please retry.",
  "failed": "Generation failed. Please retry.",
  "partialFailure": {
    "pending": "{count} images failed to generate; the rest are still in progress.",
    "kept": "{count} images failed to generate; the successful results were kept."
  },
  "result": {
    "prefixGenerated": "",
    "prefixFromReference": " from reference images",
    "countPlural": "Generated {count} images{prefix}.",
    "countSingular": "Generated one image{prefix}."
  },
  "pending": {
    "textPlural": "Generating {count} images.",
    "textSingular": "Generating an image.",
    "editPlural": "Generating {count} edit results from the reference images.",
    "editSingular": "Generating an edit result from the reference images."
  },
  "continued": {
    "textPlural": "Continuing to generate {count} images.",
    "textSingular": "Continuing to generate images.",
    "editPlural": "Continuing to generate {count} edit results.",
    "editSingular": "Continuing to generate edit results."
  },
  "regenerating": {
    "image": "Regenerating image.",
    "editResult": "Regenerating edit result."
  },
  "pendingResult": {
    "generatedPart": "Generated {count}, ",
    "remaining": "{count} {noun} still in progress.",
    "nounImage": "image | images",
    "nounEditResult": "edit result | edit results"
  },
  "editError": {
    "referenceMissing": "Reference image not found. Please re-add the reference.",
    "referenceUnreadable": "Unable to read the reference image file. Please regenerate or import the image.",
    "payloadTooLarge": "Reference images total {total}MB, exceeding the 20MB limit. Please reduce the number of images or compress them, then retry.",
    "maskUnreadable": "Unable to read the edit mask file. Please re-select the edit area.",
    "maskNotPng": "The edit mask must be a PNG file. Please re-select the edit area.",
    "sourceNotInReferences": "The edit source image is not in the current reference list. Please re-select it to continue editing.",
    "maskMissing": "Edit mask not found. Please re-select the edit area.",
    "sourceMissing": "Missing edit source image; mask editing is unavailable.",
    "sourceUnreadable": "Unable to read the edit source image. Please re-add the reference image.",
    "maskSizeMismatch": "The edit mask dimensions do not match the source image. Please re-select the edit area."
  },
  "companion": {
    "httpError": "Request failed: HTTP {status}",
    "httpErrorWithDetail": "Request failed: HTTP {status}: {detail}",
    "missingImageData": "Response is missing data[0].b64_json."
  }
};

export default generation;
