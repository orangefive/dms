<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2 class="page-title">审计日志</h2>
        <p class="page-subtitle">记录登录、项目/表/字段/数据变更与 API 密钥操作</p>
      </div>
    </div>

    <div class="card" style="padding: 12px">
      <div class="audit-filters">
        <el-select v-model="filters.action" clearable placeholder="操作类型" style="width: 180px" @change="reload">
          <el-option v-for="a in ACTIONS" :key="a" :label="a" :value="a" />
        </el-select>
        <el-select v-model="filters.resourceType" clearable placeholder="资源类型" style="width: 150px" @change="reload">
          <el-option v-for="r in RESOURCE_TYPES" :key="r" :label="r" :value="r" />
        </el-select>
        <el-button :icon="Refresh" @click="reload">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="logs" size="small">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="用户" width="120">
          <template #default="{ row }">{{ row.user?.username ?? 'API Key / 系统' }}</template>
        </el-table-column>
        <el-table-column label="资源" min-width="140">
          <template #default="{ row }">
            <span class="mono text-secondary">{{ row.resourceType }}<template v-if="row.resourceId">:{{ row.resourceId.slice(0, 8) }}</template></span>
          </template>
        </el-table-column>
        <el-table-column label="详情" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">
            <code class="mono">{{ JSON.stringify(row.detail ?? {}) }}</code>
          </template>
        </el-table-column>
        <el-table-column label="IP" width="130">
          <template #default="{ row }"><span class="mono">{{ row.ip ?? '-' }}</span></template>
        </el-table-column>
      </el-table>

      <div class="flex-between mt-8">
        <span class="text-muted" style="font-size: 13px">共 {{ total }} 条</span>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[100, 200, 300]"
          layout="sizes, prev, pager, next"
          background
          @current-change="fetch"
          @size-change="onSizeChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { auditApi } from '@/api';
import { formatDateTime } from '@/utils/format';
import type { AuditLogItem } from '@/types';

const ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'PASSWORD_CHANGE',
  'USER_CREATE',
  'USER_UPDATE',
  'USER_DELETE',
  'PROJECT_CREATE',
  'PROJECT_UPDATE',
  'PROJECT_DELETE',
  'TABLE_CREATE',
  'TABLE_UPDATE',
  'TABLE_DELETE',
  'FIELD_CREATE',
  'FIELD_UPDATE',
  'FIELD_DELETE',
  'RECORD_CREATE',
  'RECORD_UPDATE',
  'RECORD_DELETE',
  'RECORD_BATCH_CREATE',
  'RECORD_BATCH_DELETE',
  'RECORD_UPSERT',
  'API_KEY_CREATE',
  'API_KEY_UPDATE',
  'API_KEY_DELETE',
];

const RESOURCE_TYPES = ['project', 'table', 'field', 'record', 'api_key', 'unique_constraint', 'user'];

const logs = ref<AuditLogItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(300);
const loading = ref(false);
const filters = reactive({ action: '', resourceType: '' });

async function fetch(): Promise<void> {
  loading.value = true;
  try {
    const res = await auditApi.list({
      page: page.value,
      pageSize: pageSize.value,
      action: filters.action || undefined,
      resourceType: filters.resourceType || undefined,
    });
    logs.value = res.logs;
    total.value = res.pagination.total;
  } finally {
    loading.value = false;
  }
}

function reload(): void {
  page.value = 1;
  void fetch();
}

function onSizeChange(): void {
  page.value = 1;
  void fetch();
}

onMounted(fetch);
</script>

<style scoped>
.audit-filters {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
</style>
