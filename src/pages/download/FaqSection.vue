<script setup lang="ts">
/**
 * FAQ 区。用原生 <details>/<summary> 手风琴：无 JS 也能展开（爬虫与禁用 JS 的
 * 用户可见全部内容），且与 JSON-LD FAQPage 共用同一份文案（content.ts）。
 */
import { DOWNLOAD_FAQS } from "./content";
</script>

<template>
  <h2 class="text-2xl font-bold tracking-tight">常见问题</h2>
  <div class="mt-8 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-gray-50/50">
    <details
      v-for="faq in DOWNLOAD_FAQS"
      :key="faq.question"
      class="group px-6 py-4 open:bg-white first:rounded-t-2xl last:rounded-b-2xl"
    >
      <summary class="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium marker:hidden">
        {{ faq.question }}
        <svg
          class="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <p class="mt-3 text-sm leading-relaxed text-gray-600">{{ faq.answer }}</p>
    </details>
  </div>
</template>
