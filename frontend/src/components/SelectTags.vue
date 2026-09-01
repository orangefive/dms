<template>
  <div class="dms-tags">
    <template v-if="values.length">
      <span v-for="(v, i) in values" :key="i" class="dms-tag" :style="tagStyle(i)">{{ v }}</span>
    </template>
    <span v-else class="text-muted">-</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ values: string[] }>();

const PALETTE = [
  { bg: '#eef1fe', fg: '#4a5a8a', border: '#dde4fb' },
  { bg: '#ecfdf5', fg: '#18794e', border: '#d1fae5' },
  { bg: '#fff7ed', fg: '#b45309', border: '#ffedd5' },
  { bg: '#fdf2f8', fg: '#be185d', border: '#fce7f3' },
  { bg: '#f0f9ff', fg: '#0369a1', border: '#e0f2fe' },
  { bg: '#f5f3ff', fg: '#6d28d9', border: '#ede9fe' },
];

function tagStyle(index: number): Record<string, string> {
  const c = PALETTE[index % PALETTE.length];
  return { background: c.bg, color: c.fg, borderColor: c.border };
}

const values = computed(() => props.values);
</script>
