<template>
  <el-dialog v-model="visible" title="多条件筛选（AND）" width="680px">
    <div v-for="(cond, index) in conditions" :key="index" class="qf-row">
      <el-select v-model="cond.field" style="width: 180px" placeholder="字段" @change="onFieldChange(cond)">
        <el-option v-for="f in fields" :key="f.id" :label="f.name" :value="f.fieldKey" />
      </el-select>
      <el-select v-model="cond.operator" style="width: 140px" placeholder="操作符">
        <el-option
          v-for="op in operatorsFor(cond.field)"
          :key="op"
          :label="OPERATOR_LABELS[op] ?? op"
          :value="op"
        />
      </el-select>

      <template v-if="!isNullOperator(cond.operator)">
        <el-input-number
          v-if="fieldTypeOf(cond.field) === 'NUMBER' || fieldFormulaNumber(cond.field)"
          v-model="cond.value"
          :controls="false"
          style="width: 180px"
          placeholder="数值"
        />
        <el-select
          v-else-if="fieldTypeOf(cond.field) === 'SINGLE_SELECT'"
          v-model="cond.value"
          style="width: 180px"
          placeholder="选项"
          clearable
        >
          <el-option
            v-for="opt in fieldOptions(cond.field)"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-select
          v-else-if="fieldTypeOf(cond.field) === 'MULTI_SELECT'"
          v-model="cond.value"
          style="width: 180px"
          placeholder="选项"
          clearable
        >
          <el-option
            v-for="opt in fieldOptions(cond.field)"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-date-picker
          v-else-if="fieldTypeOf(cond.field) === 'DATE'"
          v-model="cond.value"
          :type="fieldConfig(cond.field)?.showTime ? 'datetime' : 'date'"
          :value-format="fieldConfig(cond.field)?.showTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'"
          style="width: 180px"
        />
        <el-switch
          v-else-if="fieldTypeOf(cond.field) === 'FORMULA' && fieldFormulaBoolean(cond.field)"
          v-model="cond.value"
          active-text="true"
          inactive-text="false"
        />
        <el-input
          v-else
          v-model="cond.value"
          style="width: 180px"
          placeholder="查询值"
          clearable
        />
      </template>
      <span v-else class="text-muted" style="width: 180px; font-size: 12px">（无需值）</span>

      <el-button
        type="danger"
        text
        :icon="Delete"
        :disabled="conditions.length === 1"
        @click="conditions.splice(index, 1)"
      />
    </div>

    <el-button size="small" :icon="Plus" class="mt-8" @click="addCondition">添加条件</el-button>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="apply">应用筛选</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Delete, Plus } from '@element-plus/icons-vue';
import { OPERATOR_LABELS, operatorsForType } from './cell';
import type { DataField, QueryFilter, QueryOperator } from '@/types';

const props = defineProps<{
  modelValue: boolean;
  fields: DataField[];
  initial: QueryFilter[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'apply', filters: QueryFilter[]): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

interface Cond {
  field: string;
  operator: QueryOperator;
  value?: unknown;
}

const conditions = ref<Cond[]>([]);

watch(visible, (v) => {
  if (v) {
    conditions.value = props.initial.length
      ? props.initial.map((f) => ({ ...f }))
      : [{ field: '', operator: 'eq', value: '' }];
  }
});

function fieldOf(key: string): DataField | undefined {
  return props.fields.find((f) => f.fieldKey === key);
}

function fieldTypeOf(key: string): string | undefined {
  return fieldOf(key)?.fieldType;
}

function fieldConfig(key: string): DataField['config'] {
  return fieldOf(key)?.config ?? null;
}

function fieldOptions(key: string): Array<{ label: string; value: string }> {
  return fieldOf(key)?.config?.options ?? [];
}

function fieldFormulaNumber(key: string): boolean {
  const f = fieldOf(key);
  return f?.fieldType === 'FORMULA' && f.formulaResultType === 'NUMBER';
}

function fieldFormulaBoolean(key: string): boolean {
  const f = fieldOf(key);
  return f?.fieldType === 'FORMULA' && f.formulaResultType === 'BOOLEAN';
}

function operatorsFor(key: string): QueryOperator[] {
  const field = fieldOf(key);
  if (!field) {
    return ['eq'];
  }
  return operatorsForType(field) as QueryOperator[];
}

function isNullOperator(op: string): boolean {
  return op === 'is_null' || op === 'is_not_null';
}

function onFieldChange(cond: Cond): void {
  const ops = operatorsFor(cond.field);
  if (!ops.includes(cond.operator)) {
    cond.operator = ops[0];
  }
  cond.value = cond.value === undefined ? '' : cond.value;
}

function addCondition(): void {
  conditions.value.push({ field: '', operator: 'eq', value: '' });
}

function apply(): void {
  const filters: QueryFilter[] = conditions.value
    .filter((c) => c.field)
    .map((c) => ({
      field: c.field,
      operator: c.operator,
      ...(isNullOperator(c.operator) ? {} : { value: c.value }),
    }));
  emit('apply', filters);
  visible.value = false;
}
</script>

<style scoped>
.qf-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
</style>
