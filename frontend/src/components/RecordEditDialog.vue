<template>
  <el-dialog
    v-model="visible"
    :title="record ? '编辑记录' : '新增记录'"
    width="640px"
    :close-on-click-modal="false"
  >
    <el-form v-loading="loading" label-width="110px" class="record-form">
      <el-form-item v-for="field in editableFields" :key="field.id" :label="fieldLabel(field)">
        <!-- 公式字段：只读显示计算结果 -->
        <div v-if="field.fieldType === 'FORMULA'" class="formula-readonly">
          <span v-if="previewError(field)" class="dms-tag dms-tag--error">{{ previewError(field) }}</span>
          <span v-else class="formula-value">{{ previewValue(field) ?? '-' }}</span>
          <span class="text-muted" style="font-size: 12px">公式字段自动计算，不可编辑</span>
        </div>

        <el-input-number
          v-else-if="field.fieldType === 'NUMBER'"
          v-model="formData[field.fieldKey]"
          :controls="false"
          style="width: 100%"
          :placeholder="'请输入' + field.name"
        />

        <el-input
          v-else-if="field.fieldType === 'MULTI_LINE_TEXT'"
          v-model="formData[field.fieldKey]"
          type="textarea"
          :rows="3"
          :maxlength="field.config?.maxLength ?? 10000"
        />

        <el-select
          v-else-if="field.fieldType === 'SINGLE_SELECT'"
          v-model="formData[field.fieldKey]"
          style="width: 100%"
          :placeholder="'请选择' + field.name"
          clearable
        >
          <el-option
            v-for="opt in field.config?.options ?? []"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>

        <el-select
          v-else-if="field.fieldType === 'MULTI_SELECT'"
          v-model="formData[field.fieldKey]"
          style="width: 100%"
          multiple
          :placeholder="'请选择' + field.name"
          clearable
        >
          <el-option
            v-for="opt in field.config?.options ?? []"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>

        <el-date-picker
          v-else-if="field.fieldType === 'DATE'"
          v-model="formData[field.fieldKey]"
          :type="field.config?.showTime ? 'datetime' : 'date'"
          :value-format="field.config?.showTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'"
          style="width: 100%"
          :placeholder="field.config?.showTime ? '选择日期时间' : '选择日期'"
        />

        <el-input
          v-else
          v-model="formData[field.fieldKey]"
          :maxlength="field.config?.maxLength ?? (field.fieldType === 'STRING' ? 1024 : 1024)"
          :placeholder="'请输入' + field.name"
        />
      </el-form-item>

      <el-empty
        v-if="editableFields.length === 0"
        description="该表没有可编辑字段，请先在字段管理中创建字段"
      />
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="editableFields.length === 0" @click="save">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { recordApi } from '@/api';
import { formulaErrorText } from '@/utils/format';
import type { DataField, RecordRow } from '@/types';

const props = defineProps<{
  modelValue: boolean;
  tableId: string;
  fields: DataField[];
  record: RecordRow | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'saved'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const formData = reactive<Record<string, unknown>>({});
const loading = ref(false);
const saving = ref(false);

const editableFields = computed(() =>
  props.fields.filter((f) => f.fieldType !== 'FORMULA'),
);

function fieldLabel(field: DataField): string {
  return `${field.name}${field.isUnique ? ' *' : ''}`;
}

function previewValue(field: DataField): unknown {
  if (!props.record) {
    return null;
  }
  const v = props.record.data?.[field.fieldKey];
  return v ?? null;
}

function previewError(field: DataField): string | null {
  const code = props.record?.formulaErrors?.[field.fieldKey];
  return code ? formulaErrorText(code) : null;
}

watch(
  () => [props.modelValue, props.record] as const,
  ([open]) => {
    if (open) {
      // 清空并预填
      for (const key of Object.keys(formData)) {
        delete formData[key];
      }
      if (props.record) {
        for (const field of editableFields.value) {
          const v = props.record.data?.[field.fieldKey];
          if (v !== undefined && v !== null) {
            formData[field.fieldKey] = v;
          } else if (field.fieldType === 'MULTI_SELECT') {
            formData[field.fieldKey] = [];
          }
        }
      }
    }
  },
);

async function save(): Promise<void> {
  // 空字符串视为未填写
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(formData)) {
    if (value === '' || value === undefined || value === null) {
      continue;
    }
    payload[key] = value;
  }
  saving.value = true;
  try {
    if (props.record?.id) {
      await recordApi.update(props.tableId, props.record.id, payload);
      ElMessage.success('记录已更新');
    } else {
      await recordApi.create(props.tableId, payload);
      ElMessage.success('记录已创建');
    }
    visible.value = false;
    emit('saved');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.record-form {
  max-height: 60vh;
  overflow: auto;
  padding-right: 8px;
}

.formula-readonly {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.formula-value {
  font-weight: 500;
  font-size: 14px;
}
</style>
