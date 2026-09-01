<template>
  <div class="table-view">
    <div v-loading="initialLoading" class="tv-wrap">
      <!-- 头部 -->
      <div class="tv-header">
        <div class="tv-header-left">
          <div class="tv-title-row">
            <span class="tv-title">{{ table?.name ?? '数据表' }}</span>
            <el-tag size="small" :type="table?.tableType === 'SYSTEM' ? 'primary' : 'warning'" effect="plain">
              {{ table?.tableType === 'SYSTEM' ? '动态表' : '外部表' }}
            </el-tag>
            <el-tag v-if="table?.tableType === 'EXTERNAL'" size="small" type="info" effect="plain" class="mono">
              {{ table?.externalTableName }}
            </el-tag>
          </div>
          <div class="tv-subtitle">
            <span v-if="table?.project" class="tv-project" @click="goProject">
              {{ table.project.name }} /
            </span>
            <span class="text-muted">{{ table?.description || '' }}</span>
          </div>
        </div>
        <div class="tv-header-right">
          <el-button :icon="Refresh" :loading="loading" @click="reload">刷新</el-button>
          <el-button
            v-if="auth.can('field:read')"
            :icon="Setting"
            @click="fieldDialog = true"
          >
            字段管理
          </el-button>
          <el-button
            v-if="canWriteRecords && !isExternal"
            :icon="Upload"
            @click="importDialog = true"
          >
            导入 Excel
          </el-button>
          <el-button
            v-if="auth.can('export') && fields.length > 0"
            :icon="Download"
            :loading="exporting"
            @click="doExport"
          >
            导出 Excel
          </el-button>
          <el-button
            v-if="canDeleteRecords"
            type="danger"
            plain
            :icon="Delete"
            :disabled="selectedCount === 0"
            @click="batchDelete"
          >
            批量删除{{ selectedCount > 0 ? `（${selectedCount}）` : '' }}
          </el-button>
          <el-button
            v-if="canWriteRecords"
            type="primary"
            :icon="Plus"
            @click="openCreate"
          >
            新增记录
          </el-button>
        </div>
      </div>

      <!-- 查询工具栏 -->
      <div class="tv-toolbar">
        <div class="tv-query">
          <el-select v-model="quickField" style="width: 160px" placeholder="字段" @change="onQuickFieldChange">
            <el-option
              v-for="f in queryableFields"
              :key="f.id"
              :label="f.name"
              :value="f.fieldKey"
            />
          </el-select>
          <el-select v-model="quickOperator" style="width: 130px">
            <el-option label="精确匹配" value="eq" />
            <el-option v-if="quickFieldSupportsContains" label="包含（模糊）" value="contains" />
          </el-select>
          <el-input
            v-model="quickValue"
            placeholder="输入查询值后回车"
            style="width: 220px"
            clearable
            @keyup.enter="applyQuickQuery"
          />
          <el-button type="primary" :icon="Search" :loading="loading" @click="applyQuickQuery">
            查询
          </el-button>
          <el-button :icon="Filter" @click="filterDialog = true">筛选</el-button>
          <el-button text :disabled="filters.length === 0" @click="clearAllFilters">
            清除全部
          </el-button>
        </div>
        <div class="tv-result-info">
          <template v-if="filters.length > 0">
            <span class="tv-result-count">找到 {{ total }} 条记录</span>
          </template>
          <template v-else>
            <span class="tv-result-count">共 {{ total }} 条记录</span>
          </template>
        </div>
      </div>

      <!-- 已应用条件 Tags -->
      <div v-if="filters.length > 0" class="tv-tags">
        <el-tag
          v-for="(f, i) in filters"
          :key="i"
          closable
          effect="plain"
          class="tv-tag"
          @close="removeFilter(i)"
        >
          {{ fieldName(f.field) }} {{ OPERATOR_LABELS[f.operator] ?? f.operator }}
          {{ isNullOp(f.operator) ? '' : `= ${String(f.value)}` }}
        </el-tag>
        <el-button v-if="total === 0 && quickOperator === 'eq'" size="small" text type="primary" @click="retryContains">
          使用包含搜索重新查询
        </el-button>
      </div>

      <!-- 数据网格 -->
      <div v-if="fields.length === 0" class="tv-empty card">
        <el-empty description="该表还没有字段">
          <el-button v-if="auth.can('field:write')" type="primary" :icon="Setting" @click="fieldDialog = true">
            去创建字段
          </el-button>
        </el-empty>
      </div>

      <div v-else v-loading="loading" class="tv-grid card">
        <div v-if="!loading && records.length === 0" class="tv-grid-empty">
          <el-empty :description="filters.length > 0 ? '未找到完全匹配的数据' : '该表还没有数据'">
            <template v-if="canWriteRecords && filters.length === 0">
              <el-button type="primary" :icon="Plus" @click="openCreate">新增第一条记录</el-button>
            </template>
            <template v-else-if="filters.length > 0">
              <el-button @click="clearAllFilters">清除筛选条件</el-button>
            </template>
          </el-empty>
        </div>
        <!-- 表格独立弹性容器：高度不含分页条，避免最后一行数据被分页条遮挡 -->
        <div v-else class="tv-grid-body">
          <vxe-table
            ref="tableRef"
            :data="records"
            height="auto"
            :row-config="{ isHover: true }"
            :checkbox-config="{ highlight: true }"
            :sort-config="{ remote: true, trigger: 'cell' }"
            @sort-change="onSortChange"
            @checkbox-change="onCheckboxChange"
            @checkbox-all="onCheckboxChange"
          >
            <vxe-column v-if="canDeleteRecords" type="checkbox" width="46" align="center" fixed="left" />
            <vxe-column v-for="field in fields" :key="field.id" :field="field.fieldKey" :title="field.name" :min-width="columnWidth(field)" :sortable="isSortable(field)">
              <template #header>
                <div class="tv-col-header">
                  <span class="tv-col-name">{{ field.name }}</span>
                  <FieldTypeTag :type="field.fieldType" :result-type="field.formulaResultType" />
                </div>
              </template>
              <template #default="{ row }">
                <SelectTags
                  v-if="field.fieldType === 'MULTI_SELECT' && Array.isArray(row.data?.[field.fieldKey])"
                  :values="multiLabels(field, row.data?.[field.fieldKey])"
                />
                <span
                  v-else-if="cellOf(field, row).isError"
                  class="dms-tag dms-tag--error"
                >
                  {{ cellOf(field, row).text }}
                </span>
                <span v-else-if="field.fieldType === 'SINGLE_SELECT' && cellOf(field, row).text" class="dms-tag">
                  {{ cellOf(field, row).text }}
                </span>
                <span
                  v-else-if="field.fieldType === 'FORMULA'"
                  class="formula-value"
                >
                  {{ cellOf(field, row).text || '-' }}
                </span>
                <span v-else>{{ cellOf(field, row).text || '-' }}</span>
              </template>
            </vxe-column>

            <vxe-column
              v-if="canWriteRecords"
              title="操作"
              width="130"
              fixed="right"
              align="center"
            >
              <template #default="{ row }">
                <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
                <el-button size="small" text type="danger" @click="removeRecord(row)">删除</el-button>
              </template>
            </vxe-column>
          </vxe-table>
        </div>

        <!-- 翻页按钮：始终显示在最后一行数据下方；每页固定 300 行，数据满 300 行自动新增一页 -->
        <div class="tv-pagination">
          <span class="text-secondary" style="font-size: 13px">
            共 {{ total }} 条记录 · 每页 {{ PAGE_SIZE }} 行 · 第 {{ page }} / {{ totalPages }} 页
          </span>
          <el-pagination
            v-model:current-page="page"
            :page-size="PAGE_SIZE"
            :total="total"
            layout="prev, pager, next"
            background
            @current-change="load"
          />
        </div>
      </div>
    </div>

    <!-- 弹窗 -->
    <RecordEditDialog
      v-model="recordDialog"
      :table-id="tableId"
      :fields="fields"
      :record="editingRecord"
      @saved="reload"
    />

    <FieldManageDialog v-model="fieldDialog" :table-id="tableId" @changed="onFieldsChanged" />

    <ImportExcelDialog v-model="importDialog" :table-id="tableId" @saved="reload" />

    <QueryFilterDialog
      v-model="filterDialog"
      :fields="fields"
      :initial="filters"
      @apply="onFiltersApplied"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Delete, Download, Filter, Plus, Refresh, Search, Setting, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { recordApi, tableApi, exportRecords, downloadBlob } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/projects';
import { confirmDanger } from '@/utils/format';
import { cellText, isSortable, OPERATOR_LABELS } from '@/components/cell';
import type { DataField, DataTableItem, QueryFilter, QuerySort, RecordRow } from '@/types';
import FieldTypeTag from '@/components/FieldTypeTag.vue';
import SelectTags from '@/components/SelectTags.vue';
import RecordEditDialog from '@/components/RecordEditDialog.vue';
import FieldManageDialog from '@/components/FieldManageDialog.vue';
import ImportExcelDialog from '@/components/ImportExcelDialog.vue';
import QueryFilterDialog from '@/components/QueryFilterDialog.vue';

/** 每页固定 300 行：数据满 300 行自动新增一页 */
const PAGE_SIZE = 300;

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const projectStore = useProjectStore();

// 必须用 computed：组件被 keep-alive 复用时路由参数会变化，固定常量会导致显示旧表数据
const tableId = computed(() => String(route.params.id));

const table = ref<DataTableItem | null>(null);
const fields = ref<DataField[]>([]);
const records = ref<RecordRow[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const initialLoading = ref(true);
const exporting = ref(false);

const filters = ref<QueryFilter[]>([]);
const sort = ref<QuerySort[]>([]);

const quickField = ref('');
const quickOperator = ref<'eq' | 'contains'>('eq');
const quickValue = ref('');

const recordDialog = ref(false);
const editingRecord = ref<RecordRow | null>(null);
const fieldDialog = ref(false);
const filterDialog = ref(false);
const importDialog = ref(false);

const isExternal = computed(() => table.value?.tableType === 'EXTERNAL');
const canWriteRecords = computed(
  () => !isExternal.value && auth.can('record:write'),
);
const canDeleteRecords = computed(
  () => !isExternal.value && auth.can('record:delete'),
);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

// ---- 批量删除 ----
const tableRef = ref();
const selectedCount = ref(0);

function onCheckboxChange(): void {
  const rows = tableRef.value?.getCheckboxRecords?.() ?? [];
  selectedCount.value = rows.length;
}

async function batchDelete(): Promise<void> {
  const rows = tableRef.value?.getCheckboxRecords?.() ?? [];
  if (rows.length === 0) {
    ElMessage.warning('请先勾选要删除的记录');
    return;
  }
  const ok = await confirmDanger(`确定批量删除选中的 ${rows.length} 条记录吗？该操作不可恢复。`);
  if (!ok) {
    return;
  }
  const ids = rows.map((r: RecordRow) => r.id).filter((id: string | undefined): id is string => Boolean(id));
  await recordApi.batchDelete(tableId.value, ids);
  ElMessage.success(`已删除 ${ids.length} 条记录`);
  selectedCount.value = 0;
  await reload();
}

const queryableFields = computed(() =>
  fields.value.filter((f) => f.fieldType !== 'MULTI_SELECT'),
);

const quickFieldSupportsContains = computed(() => {
  const field = fields.value.find((f) => f.fieldKey === quickField.value);
  return (
    field?.fieldType === 'STRING' ||
    field?.fieldType === 'SINGLE_LINE_TEXT' ||
    field?.fieldType === 'MULTI_LINE_TEXT'
  );
});

function onQuickFieldChange(): void {
  if (!quickFieldSupportsContains.value) {
    quickOperator.value = 'eq';
  }
}

function fieldName(key: string): string {
  return fields.value.find((f) => f.fieldKey === key)?.name ?? key;
}

function isNullOp(op: string): boolean {
  return op === 'is_null' || op === 'is_not_null';
}

function cellOf(field: DataField, row: RecordRow): { text: string; isError: boolean } {
  return cellText(field, row);
}

function multiLabels(field: DataField, raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const options = field.config?.options ?? [];
  return raw.map((v) => options.find((o) => o.value === v)?.label ?? String(v));
}

function columnWidth(field: DataField): number {
  switch (field.fieldType) {
    case 'MULTI_LINE_TEXT':
      return 200;
    case 'MULTI_SELECT':
      return 160;
    case 'DATE':
      return 150;
    case 'NUMBER':
      return 110;
    case 'FORMULA':
      return 120;
    default:
      return 140;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await recordApi.query(tableId.value, {
      filters: filters.value,
      sort: sort.value.length ? sort.value : undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    });
    records.value = result.records;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
}

async function reload(): Promise<void> {
  page.value = 1;
  await load();
}

async function fetchMeta(): Promise<void> {
  initialLoading.value = true;
  try {
    const [t, f] = await Promise.all([tableApi.get(tableId.value), fieldApiList()]);
    table.value = t;
    fields.value = f;
    if (quickField.value && !fields.value.some((x) => x.fieldKey === quickField.value)) {
      quickField.value = fields.value[0]?.fieldKey ?? '';
    }
    if (!quickField.value) {
      quickField.value = fields.value[0]?.fieldKey ?? '';
    }
  } finally {
    initialLoading.value = false;
  }
}

async function fieldApiList() {
  const { fieldApi } = await import('@/api');
  return fieldApi.list(tableId.value);
}

function applyQuickQuery(): void {
  if (!quickField.value) {
    ElMessage.warning('请先选择查询字段');
    return;
  }
  if (quickOperator.value === 'eq' && quickValue.value === '') {
    // 精确查询空值 → 使用 is_null
    filters.value = [{ field: quickField.value, operator: 'is_null' }];
  } else {
    filters.value = [
      { field: quickField.value, operator: quickOperator.value, value: quickValue.value },
    ];
  }
  void reload();
}

function retryContains(): void {
  if (filters.value.length === 1 && filters.value[0].operator === 'eq') {
    filters.value = [{ ...filters.value[0], operator: 'contains' }];
    quickOperator.value = 'contains';
    quickValue.value = String(filters.value[0].value ?? '');
    void reload();
  }
}

function removeFilter(index: number): void {
  filters.value.splice(index, 1);
  void reload();
}

function clearAllFilters(): void {
  filters.value = [];
  quickValue.value = '';
  quickOperator.value = 'eq';
  void reload();
}

function onFiltersApplied(next: QueryFilter[]): void {
  filters.value = next;
  void reload();
}

function onSortChange(params: { field: string; order: string | null }): void {
  if (!params.order) {
    sort.value = [];
  } else {
    sort.value = [{ field: params.field, order: params.order as 'asc' | 'desc' }];
  }
  void reload();
}

function openCreate(): void {
  editingRecord.value = null;
  recordDialog.value = true;
}

function openEdit(row: RecordRow): void {
  editingRecord.value = row;
  recordDialog.value = true;
}

async function removeRecord(row: RecordRow): Promise<void> {
  const ok = await confirmDanger('确定删除这条记录吗？该操作不可恢复。');
  if (!ok || !row.id) {
    return;
  }
  await recordApi.remove(tableId.value, row.id);
  ElMessage.success('记录已删除');
  await load();
}

async function doExport(): Promise<void> {
  exporting.value = true;
  try {
    const { blob, filename } = await exportRecords(tableId.value, {
      filters: filters.value,
      sort: sort.value.length ? sort.value : undefined,
    });
    downloadBlob(blob, filename);
    ElMessage.success('导出成功');
  } finally {
    exporting.value = false;
  }
}

function onFieldsChanged(): void {
  void fetchMeta();
  void reload();
}

function goProject(): void {
  if (table.value?.project) {
    void router.push(`/projects/${table.value.project.id}`);
  }
}

// 切换数据表（侧边栏/新建表后打开）时：重置全部状态并加载新表，避免显示旧表数据。
// 注意：路由参数变化也可能来自「离开数据表页」（如切换到项目页/管理表页时 params.id 变成项目 ID），
// 此时必须跳过加载，否则会把项目 ID 当作表 ID 请求而报「数据表不存在」。
watch(
  () => route.params.id,
  () => {
    if (route.name !== 'table') {
      return;
    }
    page.value = 1;
    filters.value = [];
    sort.value = [];
    quickValue.value = '';
    quickOperator.value = 'eq';
    selectedCount.value = 0;
    records.value = [];
    table.value = null;
    fields.value = [];
    void fetchMeta().then(() => load());
  },
);

onMounted(() => {
  void fetchMeta().then(() => load());
  void projectStore.refresh();
});
</script>

<style scoped>
.table-view {
  height: 100%;
  min-height: 0;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
}

.tv-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.tv-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.tv-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tv-title {
  font-size: 19px;
  font-weight: 600;
}

.tv-subtitle {
  font-size: 13px;
  color: var(--dms-text-secondary);
  margin-top: 4px;
}

.tv-project {
  color: var(--dms-primary);
  cursor: pointer;
}

.tv-project:hover {
  text-decoration: underline;
}

.tv-header-right {
  display: flex;
  gap: 8px;
}

.tv-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border: 1px solid var(--dms-border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.tv-query {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.tv-result-info {
  font-size: 13px;
}

.tv-result-count {
  color: var(--dms-text-secondary);
}

.tv-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.tv-tag {
  border-radius: 6px;
}

.tv-grid {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 8px;
}

/* 表格独立容器：flex 撑满分页条之外的区域，vxe 在此容器内滚动，最后一行不会被分页条遮挡 */
.tv-grid-body {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.tv-grid-body :deep(.vxe-table) {
  height: 100%;
}

.tv-col-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tv-col-name {
  font-weight: 600;
}

.tv-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px 2px;
  border-top: 1px solid var(--dms-border);
  margin-top: 8px;
  flex-shrink: 0;
  /* 提升层级：避免被 vxe-table 固定列（fixed right）层覆盖导致无法点击 */
  position: relative;
  z-index: 30;
  background: #fff;
}

.tv-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}
</style>
