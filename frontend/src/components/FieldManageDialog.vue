<template>
  <el-dialog
    v-model="visible"
    title="字段管理"
    width="880px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div class="fm-toolbar">
      <div class="text-secondary" style="font-size: 13px">
        {{ fields.length }} 个字段 · 字段标识（field_key）为稳定引用，n8n / 公式均使用它
      </div>
      <div>
        <el-button size="small" @click="showConstraints = !showConstraints">
          {{ showConstraints ? '收起唯一约束' : '组合唯一约束' }}
        </el-button>
        <el-button v-if="canWrite" size="small" type="primary" :icon="Plus" @click="openCreate">新建字段</el-button>
      </div>
    </div>

    <!-- 组合唯一约束 -->
    <div v-if="showConstraints" class="fm-constraints">
      <div class="fm-constraints-head">
        <span class="text-secondary" style="font-size: 13px">唯一约束（单字段 is_unique 自动生成，组合约束在此管理）</span>
        <el-button v-if="canWrite" size="small" :icon="Plus" @click="openConstraintCreate">添加组合约束</el-button>
      </div>
      <div v-for="c in constraints" :key="c.id" class="fm-constraint">
        <span class="mono">{{ c.name }}</span>
        <span class="dms-tags">
          <span v-for="k in c.fields" :key="k" class="dms-tag">{{ k }}</span>
        </span>
        <el-button v-if="canWrite" size="small" type="danger" text @click="removeConstraint(c)">删除</el-button>
      </div>
      <el-empty v-if="constraints.length === 0" :image-size="48" description="暂无唯一约束" />
    </div>

    <el-table v-loading="loading" :data="fields" size="small" max-height="420">
      <el-table-column type="index" label="#" width="44" />
      <el-table-column label="名称" min-width="140">
        <template #default="{ row }">
          <span class="fm-name">{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column label="标识" min-width="140">
        <template #default="{ row }">
          <span class="mono text-secondary">{{ row.fieldKey }}</span>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="130">
        <template #default="{ row }">
          <FieldTypeTag :type="row.fieldType" :result-type="row.formulaResultType" />
        </template>
      </el-table-column>
      <el-table-column label="唯一" width="60" align="center">
        <template #default="{ row }">
          <el-icon v-if="row.isUnique" color="#4f6ef7"><CircleCheckFilled /></el-icon>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="索引" width="60" align="center">
        <template #default="{ row }">
          <el-icon v-if="row.isIndexed" color="#4f6ef7"><Grid /></el-icon>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="顺序" width="86" align="center">
        <template #default="{ row, $index }">
          <template v-if="canWrite">
            <el-button
              size="small"
              text
              :disabled="$index === 0"
              @click="move(row, -1)"
            >
              <el-icon><Top /></el-icon>
            </el-button>
            <el-button
              size="small"
              text
              :disabled="$index === fields.length - 1"
              @click="move(row, 1)"
            >
              <el-icon><Bottom /></el-icon>
            </el-button>
          </template>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <template v-if="canWrite">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="removeField(row)">删除</el-button>
          </template>
          <span v-else class="text-muted" style="font-size: 12px">只读</span>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>

    <!-- 字段编辑弹窗 -->
    <el-dialog
      v-model="fieldDialog"
      :title="editingField ? '编辑字段' : '新建字段'"
      width="620px"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-form ref="fieldFormRef" :model="fieldForm" :rules="fieldRules" label-width="100px">
        <el-form-item label="字段名称" prop="name">
          <el-input v-model="fieldForm.name" maxlength="128" placeholder="例如：SKU" />
        </el-form-item>
        <el-form-item label="字段标识" :prop="editingField ? '' : 'fieldKey'">
          <el-input
            v-model="fieldForm.fieldKey"
            :disabled="Boolean(editingField)"
            maxlength="128"
            placeholder="自动生成；建议填写英文标识便于 n8n 引用"
          />
          <div v-if="editingField" class="text-muted" style="font-size: 12px">
            字段标识创建后不可修改（公式/查询依赖它）
          </div>
        </el-form-item>
        <el-form-item label="字段类型" prop="fieldType">
          <el-select
            v-model="fieldForm.fieldType"
            :disabled="Boolean(editingField)"
            style="width: 100%"
          >
            <el-option v-for="t in FIELD_TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
          <div v-if="editingField" class="text-muted" style="font-size: 12px">
            字段类型创建后不可修改（禁止互转）
          </div>
        </el-form-item>

        <!-- 选项编辑 -->
        <el-form-item v-if="isSelectType" label="选项">
          <div class="fm-options">
            <div v-for="(opt, i) in fieldForm.options" :key="i" class="fm-option-row">
              <el-input v-model="opt.label" size="small" placeholder="显示名（如 Amazon）" style="flex: 1" />
              <el-input v-model="opt.value" size="small" placeholder="值（如 amazon）" style="flex: 1" class="mono" />
              <el-button size="small" text type="danger" :icon="Delete" @click="fieldForm.options.splice(i, 1)" />
            </div>
            <el-button size="small" :icon="Plus" @click="fieldForm.options.push({ label: '', value: '' })">
              添加选项
            </el-button>
          </div>
        </el-form-item>

        <el-form-item v-if="fieldForm.fieldType === 'DATE'" label="显示时间">
          <el-switch v-model="fieldForm.showTime" />
          <span class="text-muted" style="font-size: 12px; margin-left: 8px">
            {{ fieldForm.showTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD' }}
          </span>
        </el-form-item>

        <el-form-item v-if="fieldForm.fieldType === 'FORMULA'" label="公式" prop="formulaExpression">
          <FormulaEditor
            v-model="fieldForm.formulaExpression"
            :table-id="tableId"
            :fields="fields"
            :field-id="editingField?.id"
            @valid-change="formulaValid = $event"
          />
        </el-form-item>

        <el-form-item v-if="!isSelectType && fieldForm.fieldType !== 'FORMULA' && fieldForm.fieldType !== 'MULTI_SELECT'" label="唯一约束">
          <el-switch v-model="fieldForm.isUnique" />
          <span class="text-muted" style="font-size: 12px; margin-left: 8px">该字段值不允许重复（大小写敏感）</span>
        </el-form-item>
        <el-form-item label="索引标记">
          <el-switch v-model="fieldForm.isIndexed" />
          <span class="text-muted" style="font-size: 12px; margin-left: 8px">高频查询字段（如 SKU / 订单号）建议标记</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fieldDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveField">保存</el-button>
      </template>
    </el-dialog>

    <!-- 组合约束弹窗 -->
    <el-dialog v-model="constraintDialog" title="添加组合唯一约束" width="480px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="约束名称" required>
          <el-input v-model="constraintForm.name" placeholder="例如：uq_shop_sku" class="mono" />
        </el-form-item>
        <el-form-item label="字段" required>
          <el-select v-model="constraintForm.fields" multiple style="width: 100%" placeholder="选择字段（至少 1 个）">
            <el-option
              v-for="f in constraintCandidates"
              :key="f.fieldKey"
              :label="`${f.name}（${f.fieldKey}）`"
              :value="f.fieldKey"
            />
          </el-select>
          <div class="text-muted" style="font-size: 12px; margin-top: 6px">
            示例：shop + sku 允许 Amazon-US/ABC123 与 Amazon-DE/ABC123 并存，但同店铺同 SKU 重复会被拒绝
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="constraintDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveConstraint">保存</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Bottom, CircleCheckFilled, Delete, Grid, Plus, Top } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { fieldApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { confirmDanger } from '@/utils/format';
import type { DataField, UniqueConstraintItem } from '@/types';
import FieldTypeTag from './FieldTypeTag.vue';
import FormulaEditor from './FormulaEditor.vue';

const props = defineProps<{
  modelValue: boolean;
  tableId: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'changed'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const auth = useAuthStore();
const canWrite = computed(() => auth.can('field:write'));

const fields = ref<DataField[]>([]);
const constraints = ref<UniqueConstraintItem[]>([]);
const loading = ref(false);
const saving = ref(false);
const showConstraints = ref(false);

const FIELD_TYPE_OPTIONS = [
  { label: '文本', value: 'STRING' },
  { label: '单行文本', value: 'SINGLE_LINE_TEXT' },
  { label: '多行文本', value: 'MULTI_LINE_TEXT' },
  { label: '数字', value: 'NUMBER' },
  { label: '单选', value: 'SINGLE_SELECT' },
  { label: '多选', value: 'MULTI_SELECT' },
  { label: '日期', value: 'DATE' },
  { label: '公式', value: 'FORMULA' },
];

// ---------- 字段表单 ----------
const fieldDialog = ref(false);
const editingField = ref<DataField | null>(null);
const formulaValid = ref(true);
const fieldFormRef = ref<FormInstance>();
const fieldForm = reactive<{
  name: string;
  fieldKey: string;
  fieldType: string;
  options: Array<{ label: string; value: string }>;
  showTime: boolean;
  isUnique: boolean;
  isIndexed: boolean;
  formulaExpression: string;
}>({
  name: '',
  fieldKey: '',
  fieldType: 'SINGLE_LINE_TEXT',
  options: [],
  showTime: false,
  isUnique: false,
  isIndexed: false,
  formulaExpression: '',
});

const isSelectType = computed(
  () => fieldForm.fieldType === 'SINGLE_SELECT' || fieldForm.fieldType === 'MULTI_SELECT',
);

const fieldRules: FormRules = {
  name: [{ required: true, message: '请输入字段名称', trigger: 'blur' }],
  fieldKey: [
    {
      // 留空 = 自动生成标识；填写时校验格式
      validator: (_r, v: string, cb) => {
        if (v && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
          cb(new Error('仅支持字母、数字、下划线，不能以数字开头'));
        } else {
          cb();
        }
      },
      trigger: 'blur',
    },
  ],
  fieldType: [{ required: true, message: '请选择字段类型', trigger: 'change' }],
  formulaExpression: [
    {
      validator: (_r, _v, cb) => {
        if (fieldForm.fieldType === 'FORMULA' && !formulaValid.value) {
          cb(new Error('公式校验未通过，请先修正公式'));
        } else {
          cb();
        }
      },
      trigger: 'change',
    },
  ],
};

async function fetchAll(): Promise<void> {
  loading.value = true;
  try {
    const [f, c] = await Promise.all([
      fieldApi.list(props.tableId),
      fieldApi.listConstraints(props.tableId),
    ]);
    fields.value = f;
    constraints.value = c.map((x) => ({
      ...x,
      fields: Array.isArray(x.fields) ? x.fields : [],
    }));
  } finally {
    loading.value = false;
  }
}

watch(visible, (v) => {
  if (v) {
    void fetchAll();
  }
});

function openCreate(): void {
  editingField.value = null;
  Object.assign(fieldForm, {
    name: '',
    fieldKey: '',
    fieldType: 'SINGLE_LINE_TEXT',
    options: [],
    showTime: false,
    isUnique: false,
    isIndexed: false,
    formulaExpression: '',
  });
  formulaValid.value = true;
  fieldDialog.value = true;
}

function openEdit(field: DataField): void {
  editingField.value = field;
  Object.assign(fieldForm, {
    name: field.name,
    fieldKey: field.fieldKey,
    fieldType: field.fieldType,
    options: (field.config?.options ?? []).map((o) => ({ ...o })),
    showTime: Boolean(field.config?.showTime),
    isUnique: field.isUnique,
    isIndexed: field.isIndexed,
    formulaExpression: field.formulaExpression ?? '',
  });
  formulaValid.value = true;
  fieldDialog.value = true;
}

async function saveField(): Promise<void> {
  const valid = await fieldFormRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }
  if (isSelectType.value && fieldForm.options.some((o) => !o.label.trim() || !o.value.trim())) {
    ElMessage.warning('请完整填写所有选项的显示名与值');
    return;
  }
  if (fieldForm.fieldType === 'FORMULA' && !formulaValid.value) {
    ElMessage.warning('公式校验未通过');
    return;
  }
  saving.value = true;
  try {
    const payload: Record<string, unknown> = {
      name: fieldForm.name.trim(),
      config: {
        ...(isSelectType.value ? { options: fieldForm.options } : {}),
        ...(fieldForm.fieldType === 'DATE' ? { showTime: fieldForm.showTime } : {}),
      },
      isUnique: fieldForm.isUnique,
      isIndexed: fieldForm.isIndexed,
    };
    if (!editingField.value) {
      payload.fieldKey = fieldForm.fieldKey.trim() || undefined;
      payload.fieldType = fieldForm.fieldType;
      if (fieldForm.fieldType === 'FORMULA') {
        payload.formulaExpression = fieldForm.formulaExpression;
      }
      await fieldApi.create(props.tableId, payload as never);
      ElMessage.success('字段已创建');
    } else {
      if (fieldForm.fieldType === 'FORMULA') {
        if (fieldForm.formulaExpression !== (editingField.value.formulaExpression ?? '')) {
          payload.formulaExpression = fieldForm.formulaExpression;
        } else {
          delete payload.formulaExpression;
        }
      } else {
        delete payload.formulaExpression;
      }
      await fieldApi.update(editingField.value.id, payload as never);
      ElMessage.success('字段已更新');
    }
    fieldDialog.value = false;
    await fetchAll();
    emit('changed');
  } finally {
    saving.value = false;
  }
}

async function removeField(field: DataField): Promise<void> {
  const ok = await confirmDanger(`删除字段「${field.name}」将清除该字段的所有数据，且不可恢复。`);
  if (!ok) {
    return;
  }
  try {
    await fieldApi.remove(field.id);
    ElMessage.success('字段已删除');
    await fetchAll();
    emit('changed');
  } catch {
    // 错误信息由全局拦截器提示（如被公式引用）
  }
}

async function move(field: DataField, delta: number): Promise<void> {
  const idx = fields.value.findIndex((f) => f.id === field.id);
  const target = idx + delta;
  if (target < 0 || target >= fields.value.length) {
    return;
  }
  const next = [...fields.value];
  const [item] = next.splice(idx, 1);
  next.splice(target, 0, item);
  fields.value = next;
  try {
    await fieldApi.reorder(props.tableId, next.map((f) => f.id));
    ElMessage.success('顺序已调整');
  } catch {
    await fetchAll();
  }
}

// ---------- 组合约束 ----------
const constraintDialog = ref(false);
const constraintForm = reactive({ name: '', fields: [] as string[] });

const constraintCandidates = computed(() =>
  fields.value.filter(
    (f) => f.fieldType !== 'MULTI_SELECT' && f.fieldType !== 'FORMULA',
  ),
);

function openConstraintCreate(): void {
  constraintForm.name = '';
  constraintForm.fields = [];
  constraintDialog.value = true;
}

async function saveConstraint(): Promise<void> {
  if (!constraintForm.name.trim() || constraintForm.fields.length === 0) {
    ElMessage.warning('请填写约束名称并选择至少一个字段');
    return;
  }
  saving.value = true;
  try {
    await fieldApi.createConstraint(props.tableId, constraintForm.name.trim(), constraintForm.fields);
    ElMessage.success('唯一约束已创建');
    constraintDialog.value = false;
    await fetchAll();
  } finally {
    saving.value = false;
  }
}

async function removeConstraint(c: UniqueConstraintItem): Promise<void> {
  const ok = await confirmDanger(`删除唯一约束「${c.name}」？`);
  if (!ok) {
    return;
  }
  await fieldApi.removeConstraint(c.id);
  ElMessage.success('唯一约束已删除');
  await fetchAll();
}

defineExpose({ refresh: fetchAll });
</script>

<style scoped>
.fm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.fm-constraints {
  border: 1px dashed var(--dms-border-strong);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.fm-constraints-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.fm-constraint {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.fm-name {
  font-weight: 500;
}

.fm-options {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fm-option-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
