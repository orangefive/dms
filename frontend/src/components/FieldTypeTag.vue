<template>
  <span class="field-type" :title="fieldTypeLabel">
    <el-icon :size="13" class="field-type-icon"><component :is="icon" /></el-icon>
    <span class="field-type-text">{{ fieldTypeLabel }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  Calendar,
  Coin,
  EditPen,
  Grid as GridIcon,
  Histogram,
  List,
  MagicStick,
  Tickets,
} from '@element-plus/icons-vue';
import type { FieldType } from '@/types';

const props = defineProps<{ type: FieldType; resultType?: string | null }>();

const TYPE_META: Record<string, { label: string; icon: unknown }> = {
  STRING: { label: '文本', icon: EditPen },
  SINGLE_LINE_TEXT: { label: '单行文本', icon: EditPen },
  MULTI_LINE_TEXT: { label: '多行文本', icon: Tickets },
  NUMBER: { label: '数字', icon: Histogram },
  SINGLE_SELECT: { label: '单选', icon: List },
  MULTI_SELECT: { label: '多选', icon: GridIcon },
  DATE: { label: '日期', icon: Calendar },
  FORMULA: { label: '公式', icon: MagicStick },
};

const fieldTypeLabel = computed(() => {
  const meta = TYPE_META[props.type];
  if (props.type === 'FORMULA') {
    return `公式（${props.resultType === 'BOOLEAN' ? '布尔' : '数字'}）`;
  }
  return meta?.label ?? props.type;
});

const icon = computed(() => TYPE_META[props.type]?.icon ?? Coin);
</script>

<style scoped>
.field-type {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--dms-text-secondary);
}

.field-type-icon {
  color: var(--dms-primary);
}

.field-type-text {
  font-size: 12px;
}
</style>
