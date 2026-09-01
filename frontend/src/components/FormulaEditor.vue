<template>
  <div class="formula-editor">
    <el-input
      v-model="expression"
      type="textarea"
      :rows="4"
      placeholder="例如：{销售额} - {采购成本}"
      @input="scheduleValidate"
    />

    <div class="fe-status mt-8" :class="statusClass">
      <el-icon v-if="validating" class="is-loading"><Loading /></el-icon>
      <el-icon v-else-if="valid"><CircleCheck /></el-icon>
      <el-icon v-else-if="errorMessage"><CircleClose /></el-icon>
      <span v-if="validating">校验中...</span>
      <span v-else-if="valid">表达式有效，返回类型：{{ resultType === 'BOOLEAN' ? '布尔' : '数字' }}</span>
      <span v-else-if="errorMessage">{{ errorMessage }}</span>
    </div>

    <div class="fe-section">
      <div class="fe-section-title">可用字段（点击插入）</div>
      <div class="fe-chips">
        <el-tag
          v-for="field in fields"
          :key="field.id"
          :disabled="!fieldCanInsert(field)"
          effect="plain"
          class="fe-chip"
          @click="insertField(field)"
        >
          {{ field.name }}
        </el-tag>
        <span v-if="fields.length === 0" class="text-muted" style="font-size: 12px">暂无字段</span>
      </div>
    </div>

    <div class="fe-section">
      <div class="fe-section-title">函数（点击插入）</div>
      <div class="fe-chips">
        <el-tag v-for="fn in FUNCTIONS" :key="fn" effect="plain" class="fe-chip" @click="insertText(`${fn}(`)">
          {{ fn }}
        </el-tag>
      </div>
    </div>

    <div class="fe-section">
      <div class="fe-section-title">运算符</div>
      <div class="fe-chips">
        <el-tag v-for="op in OPERATORS" :key="op" effect="plain" class="fe-chip" @click="insertText(` ${op} `)">
          {{ op }}
        </el-tag>
      </div>
    </div>

    <div class="fe-help text-muted">
      规则：只能引用当前表；可引用 NUMBER 字段或返回数字/布尔的公式；支持 SUM / AVG / PRODUCT / DIVIDE / MAX / MIN。
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { CircleCheck, CircleClose, Loading } from '@element-plus/icons-vue';
import { formulaApi } from '@/api';
import type { DataField } from '@/types';

const props = defineProps<{
  tableId: string;
  fields: DataField[];
  modelValue: string;
  fieldId?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
  (e: 'valid-change', valid: boolean): void;
}>();

const FUNCTIONS = ['SUM', 'AVG', 'PRODUCT', 'DIVIDE', 'MAX', 'MIN'];
const OPERATORS = ['+', '-', '*', '/', '(', ')', '==', '!=', '>', '>=', '<', '<='];

const expression = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const valid = ref(false);
const validating = ref(false);
const errorMessage = ref('');
const resultType = ref<string>('');

const statusClass = computed(() => ({
  'fe-status--valid': valid.value,
  'fe-status--error': !!errorMessage.value,
}));

function fieldCanInsert(field: DataField): boolean {
  if (field.id === props.fieldId) {
    return false; // 禁止自引用
  }
  return (
    field.fieldType === 'NUMBER' ||
    (field.fieldType === 'FORMULA' &&
      (field.formulaResultType === 'NUMBER' || field.formulaResultType === 'BOOLEAN'))
  );
}

function insertField(field: DataField): void {
  if (!fieldCanInsert(field)) {
    return;
  }
  insertText(`{${field.name}}`);
}

function insertText(text: string): void {
  const el = document.getElementById('formula-input');
  expression.value = `${expression.value}${text}`;
  requestAnimationFrame(() => {
    el?.focus();
  });
  scheduleValidate();
}

let timer: ReturnType<typeof setTimeout> | undefined;
function scheduleValidate(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void runValidate(), 400);
}

async function runValidate(): Promise<void> {
  const expr = expression.value.trim();
  if (!expr) {
    valid.value = false;
    errorMessage.value = '';
    resultType.value = '';
    emit('valid-change', false);
    return;
  }
  validating.value = true;
  try {
    const res = await formulaApi.validate(props.tableId, expr, props.fieldId);
    if (res.valid) {
      valid.value = true;
      errorMessage.value = '';
      resultType.value = res.resultType ?? '';
      // 使用规范化表达式
      if (res.normalized && res.normalized !== expr) {
        expression.value = res.normalized;
      }
    } else {
      valid.value = false;
      errorMessage.value = res.error?.message ?? '公式无效';
      resultType.value = '';
    }
    emit('valid-change', valid.value);
  } finally {
    validating.value = false;
  }
}
</script>

<style scoped>
.fe-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--dms-text-muted);
}

.fe-status--valid {
  color: var(--dms-success);
}

.fe-status--error {
  color: var(--dms-danger);
}

.fe-section {
  margin-top: 14px;
}

.fe-section-title {
  font-size: 12px;
  color: var(--dms-text-secondary);
  margin-bottom: 8px;
}

.fe-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fe-chip {
  cursor: pointer;
  border-radius: 5px;
}

.fe-chip:hover {
  border-color: var(--dms-primary);
  color: var(--dms-primary-strong);
}

.fe-help {
  margin-top: 14px;
  font-size: 12px;
  line-height: 1.6;
}
</style>
