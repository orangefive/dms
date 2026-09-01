<template>
  <el-dialog
    v-model="visible"
    title="导入 Excel"
    width="640px"
    :close-on-click-modal="false"
    :close-on-press-escape="phase !== 'uploading'"
    :show-close="phase !== 'uploading'"
  >
    <!-- 选择文件阶段 -->
    <template v-if="phase === 'pick'">
      <el-alert type="info" :closable="false" class="mb-16">
        <p style="margin: 0 0 6px">
          1. Excel 第一行必须为表头；表头按「字段标识」或「字段名称」自动匹配数据表字段。
        </p>
        <p style="margin: 0 0 6px">
          2. 未匹配的列与公式字段列会被跳过并在结果中提示；单选/多选支持填写选项值或显示名。
        </p>
        <p style="margin: 0">3. 仅支持 .xlsx 文件（单文件 ≤ 20MB，单次 ≤ 5000 行）。</p>
      </el-alert>

      <div class="import-actions">
        <el-button :icon="Download" @click="downloadTemplate">下载导入模板</el-button>
        <el-button type="primary" :icon="Upload" :loading="uploading" @click="pickFile">
          选择 Excel 文件
        </el-button>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style="display: none"
        @change="onFileChange"
      />
      <p class="text-muted mt-8" style="font-size: 12px">
        已选文件：{{ fileName || '未选择' }}
      </p>
    </template>

    <!-- 上传中 -->
    <div v-else-if="phase === 'uploading'" v-loading="true" class="import-uploading">
      正在导入「{{ fileName }}」，逐行校验并写入，请稍候...
    </div>

    <!-- 结果阶段 -->
    <template v-else-if="result">
      <el-result
        :icon="result.errors.length === 0 && result.imported > 0 ? 'success' : 'warning'"
        :title="`导入完成：成功 ${result.imported} 条`"
        :sub-title="`文件共 ${result.totalRows} 行数据${result.errors.length ? `，${result.errors.length} 行失败` : ''}`"
      >
        <template #extra>
          <el-button type="primary" @click="close">完成</el-button>
        </template>
      </el-result>

      <div v-if="result.skippedColumns.length" class="import-section">
        <div class="import-section-title">已跳过的列（未匹配或只读）</div>
        <div class="dms-tags">
          <span v-for="col in result.skippedColumns" :key="col" class="dms-tag">{{ col }}</span>
        </div>
      </div>

      <div v-if="result.errors.length" class="import-section">
        <div class="import-section-title">失败行（已跳过，不影响其他行）</div>
        <el-table :data="result.errors" size="small" max-height="240" border>
          <el-table-column prop="row" label="行号" width="70" align="center" />
          <el-table-column prop="code" label="错误码" width="210">
            <template #default="{ row }">
              <span class="mono text-secondary">{{ row.code }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="message" label="原因" min-width="220" show-overflow-tooltip />
        </el-table>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Download, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { importApi, downloadBlob } from '@/api';
import type { ImportResult } from '@/api';

const props = defineProps<{
  modelValue: boolean;
  tableId: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'saved'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => {
    if (!v) {
      reset();
    }
    emit('update:modelValue', v);
  },
});

const phase = ref<'pick' | 'uploading' | 'done'>('pick');
const uploading = ref(false);
const fileName = ref('');
const result = ref<ImportResult | null>(null);
const fileInput = ref<HTMLInputElement>();

function reset(): void {
  phase.value = 'pick';
  uploading.value = false;
  fileName.value = '';
  result.value = null;
}

function pickFile(): void {
  fileInput.value?.click();
}

async function downloadTemplate(): Promise<void> {
  const { blob, filename } = await importApi.downloadTemplate(props.tableId);
  downloadBlob(blob, filename);
  ElMessage.success('模板已下载');
}

async function onFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) {
    return;
  }
  if (!/\.xlsx$/i.test(file.name)) {
    ElMessage.warning('仅支持 .xlsx 格式的 Excel 文件');
    return;
  }
  fileName.value = file.name;
  phase.value = 'uploading';
  try {
    result.value = await importApi.upload(props.tableId, file);
    phase.value = 'done';
    emit('saved');
  } finally {
    uploading.value = false;
  }
}

function close(): void {
  visible.value = false;
  reset();
}
</script>

<style scoped>
.import-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.import-uploading {
  min-height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dms-text-secondary);
  font-size: 14px;
}

.import-section {
  margin-top: 14px;
  border: 1px solid var(--dms-border);
  border-radius: 8px;
  padding: 10px 12px;
}

.import-section-title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
}
</style>
