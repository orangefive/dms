<template>
  <div class="page-container">
    <el-page-header @back="router.push('/projects')">
      <template #content>
        <span class="detail-title">{{ project?.name ?? '项目详情' }}</span>
      </template>
      <template #extra>
        <el-button v-if="auth.can('project:write')" type="primary" :icon="Plus" @click="openCreate">
          新建数据表
        </el-button>
      </template>
    </el-page-header>

    <div v-loading="loading" class="table-grid mt-16">
      <el-empty v-if="!loading && tables.length === 0" description="该项目还没有数据表">
        <el-button v-if="auth.can('table:write')" type="primary" :icon="Plus" @click="openCreate">
          创建第一个数据表
        </el-button>
      </el-empty>

      <div v-for="table in tables" :key="table.id" class="table-card card">
        <div class="table-card-head">
          <div class="table-icon">
            <DataBoard v-if="table.tableType === 'SYSTEM'" />
            <Connection v-else />
          </div>
          <div class="table-info">
            <div class="table-name">
              {{ table.name }}
              <el-tag size="small" :type="table.tableType === 'SYSTEM' ? 'primary' : 'warning'" effect="plain">
                {{ table.tableType === 'SYSTEM' ? '动态表' : '外部表' }}
              </el-tag>
            </div>
            <div class="table-desc">{{ table.description || '暂无描述' }}</div>
          </div>
        </div>
        <div class="table-stats">
          {{ table._count?.fields ?? 0 }} 个字段 · {{ table._count?.records ?? 0 }} 条记录
        </div>
        <div class="table-actions">
          <el-button size="small" type="primary" plain @click="openTable(table.id)">打开</el-button>
          <el-button
            v-if="auth.can('table:write')"
            size="small"
            :icon="Edit"
            @click="openEdit(table)"
          >
            编辑
          </el-button>
          <el-button
            v-if="auth.can('table:delete')"
            size="small"
            type="danger"
            plain
            :icon="Delete"
            @click="removeTable(table)"
          >
            删除
          </el-button>
        </div>
      </div>
    </div>

    <!-- 新建/编辑表 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑数据表' : '新建数据表'" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="88px">
        <el-form-item label="表名称" prop="name">
          <el-input v-model="form.name" maxlength="128" placeholder="例如：订单表" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="2000" />
        </el-form-item>
        <template v-if="!editing">
          <el-form-item label="表类型" prop="tableType">
            <el-radio-group v-model="form.tableType">
              <el-radio value="SYSTEM">动态表（系统内管理数据）</el-radio>
              <el-radio value="EXTERNAL">外部表（注册已有 MySQL 表）</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.tableType === 'EXTERNAL'" label="物理表" prop="externalTableName">
            <el-select
              v-model="form.externalTableName"
              placeholder="选择要注册的物理表"
              filterable
              style="width: 100%"
              :loading="externalLoading"
            >
              <el-option
                v-for="t in externalTables"
                :key="t.name"
                :label="`${t.name}（${t.columnCount} 列）`"
                :value="t.name"
              />
            </el-select>
            <div class="text-muted mt-8" style="font-size: 12px">
              表与字段均来自 information_schema 元数据白名单，注册后只读展示。
            </div>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Connection, DataBoard, Delete, Edit, Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { externalApi, projectApi, tableApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/projects';
import { confirmDanger } from '@/utils/format';
import type { DataTableItem, ExternalTableMeta } from '@/types';

const auth = useAuthStore();
const projectStore = useProjectStore();
const route = useRoute();
const router = useRouter();

// 使用 computed：keep-alive 缓存复用时路由参数会变化（不同项目间切换），固定常量会显示旧项目数据
const projectId = computed(() => String(route.params.id));
const project = ref<{ id: string; name: string } | null>(null);
const tables = ref<DataTableItem[]>([]);
const loading = ref(false);

const dialogVisible = ref(false);
const saving = ref(false);
const editing = ref<DataTableItem | null>(null);
const formRef = ref<FormInstance>();
const form = reactive({
  name: '',
  description: '',
  tableType: 'SYSTEM' as 'SYSTEM' | 'EXTERNAL',
  externalTableName: '',
});

const rules: FormRules = {
  name: [{ required: true, message: '请输入表名称', trigger: 'blur' }],
  externalTableName: [
    {
      validator: (_r, v: string, cb) => {
        if (form.tableType === 'EXTERNAL' && !v) {
          cb(new Error('请选择要注册的物理表'));
        } else {
          cb();
        }
      },
      trigger: 'change',
    },
  ],
};

const externalTables = ref<ExternalTableMeta[]>([]);
const externalLoading = ref(false);

watch(
  () => form.tableType,
  async (type) => {
    if (type === 'EXTERNAL' && externalTables.value.length === 0) {
      externalLoading.value = true;
      try {
        externalTables.value = await externalApi.listTables();
      } finally {
        externalLoading.value = false;
      }
    }
  },
);

async function fetch(): Promise<void> {
  loading.value = true;
  try {
    const [p, t] = await Promise.all([projectApi.get(projectId.value), tableApi.list(projectId.value)]);
    project.value = { id: p.id, name: p.name };
    tables.value = t;
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  form.name = '';
  form.description = '';
  form.tableType = 'SYSTEM';
  form.externalTableName = '';
  dialogVisible.value = true;
}

function openEdit(table: DataTableItem): void {
  editing.value = table;
  form.name = table.name;
  form.description = table.description ?? '';
  dialogVisible.value = true;
}

async function save(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await tableApi.update(editing.value.id, {
        name: form.name,
        description: form.description,
      });
      ElMessage.success('数据表已更新');
    } else {
      await tableApi.create(projectId.value, {
        name: form.name,
        description: form.description,
        tableType: form.tableType,
        externalTableName: form.externalTableName || undefined,
      });
      ElMessage.success('数据表已创建');
    }
    dialogVisible.value = false;
    await fetch();
    void projectStore.refresh();
  } finally {
    saving.value = false;
  }
}

async function removeTable(table: DataTableItem): Promise<void> {
  const ok = await confirmDanger(
    `删除数据表「${table.name}」将级联删除其下所有字段与数据，且不可恢复。`,
  );
  if (!ok) {
    return;
  }
  try {
    await ElMessageBox.prompt('请输入数据表名称以确认删除', '确认删除', {
      inputPlaceholder: table.name,
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
      inputValidator: (value: string) => value === table.name || '表名称不匹配',
    });
  } catch {
    return;
  }
  await tableApi.remove(table.id);
  ElMessage.success('数据表已删除');
  await fetch();
  void projectStore.refresh();
}

function openTable(id: string): void {
  void router.push(`/tables/${id}`);
}

onMounted(fetch);

// 路由参数变化（表格页/其它项目切回本页时 keep-alive 复用）：仅当仍停留在项目详情页时刷新
watch(
  () => route.params.id,
  () => {
    if (route.name !== 'project-detail') {
      return;
    }
    tables.value = [];
    void fetch();
  },
);

// keep-alive 缓存恢复时刷新（新建/编辑表后返回本页需看到最新列表）
onActivated(() => {
  void fetch();
});
</script>

<style scoped>
.detail-title {
  font-size: 16px;
  font-weight: 600;
}

.table-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  min-height: 160px;
}

.table-card {
  padding: 18px;
  transition: box-shadow 0.2s ease;
}

.table-card:hover {
  box-shadow: var(--dms-shadow-lg);
}

.table-card-head {
  display: flex;
  gap: 12px;
}

.table-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--dms-primary-weak);
  color: var(--dms-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.table-name {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.table-desc {
  color: var(--dms-text-secondary);
  font-size: 13px;
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.table-stats {
  color: var(--dms-text-muted);
  font-size: 12px;
  margin-top: 12px;
}

.table-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  justify-content: flex-end;
}
</style>
