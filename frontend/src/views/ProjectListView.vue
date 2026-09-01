<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2 class="page-title">项目管理</h2>
        <p class="page-subtitle">组织你的数据表，一个项目包含多个数据表</p>
      </div>
      <el-button v-if="auth.can('project:write')" type="primary" :icon="Plus" @click="openCreate">
        新建项目
      </el-button>
    </div>

    <div v-loading="loading" class="project-grid">
      <el-empty v-if="!loading && projects.length === 0" description="还没有项目">
        <el-button type="primary" :icon="Plus" @click="openCreate">创建第一个项目</el-button>
      </el-empty>

      <div v-for="project in projects" :key="project.id" class="project-card card">
        <div class="project-card-head">
          <div class="project-icon"><Folder /></div>
          <div class="project-info">
            <div class="project-name">{{ project.name }}</div>
            <div class="project-desc">{{ project.description || '暂无描述' }}</div>
          </div>
        </div>
        <div class="project-stats">
          <span>{{ project._count?.tables ?? project.tables?.length ?? 0 }} 个数据表</span>
        </div>
        <div class="project-actions">
          <el-button size="small" type="primary" plain @click="openProject(project.id)">
            打开
          </el-button>
          <el-button
            v-if="auth.can('project:write')"
            size="small"
            :icon="Edit"
            @click="openEdit(project)"
          >
            编辑
          </el-button>
          <el-button
            v-if="auth.can('project:delete')"
            size="small"
            type="danger"
            plain
            :icon="Delete"
            @click="removeProject(project)"
          >
            删除
          </el-button>
        </div>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑项目' : '新建项目'" width="460px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="72px">
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="form.name" maxlength="128" placeholder="例如：运营数据" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            maxlength="2000"
            placeholder="项目用途说明（可选）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Delete, Edit, Folder, Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { projectApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/projects';
import { confirmDanger } from '@/utils/format';
import type { Project } from '@/types';

const auth = useAuthStore();
const projectStore = useProjectStore();
const router = useRouter();

const projects = ref<Project[]>([]);
const loading = ref(false);
const dialogVisible = ref(false);
const saving = ref(false);
const editing = ref<Project | null>(null);

const formRef = ref<FormInstance>();
const form = reactive({ name: '', description: '' });

const rules: FormRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
};

async function fetch(): Promise<void> {
  loading.value = true;
  try {
    projects.value = await projectApi.list(false);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  form.name = '';
  form.description = '';
  dialogVisible.value = true;
}

function openEdit(project: Project): void {
  editing.value = project;
  form.name = project.name;
  form.description = project.description ?? '';
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
      await projectApi.update(editing.value.id, form);
      ElMessage.success('项目已更新');
    } else {
      await projectApi.create(form);
      ElMessage.success('项目已创建');
    }
    dialogVisible.value = false;
    await fetch();
    void projectStore.refresh();
  } finally {
    saving.value = false;
  }
}

async function removeProject(project: Project): Promise<void> {
  const ok = await confirmDanger(
    `删除项目「${project.name}」将级联删除其下所有数据表与数据，且不可恢复。\n请输入项目名称确认：`,
  );
  if (!ok) {
    return;
  }
  // 输入名称二次确认
  const { ElMessageBox } = await import('element-plus');
  try {
    await ElMessageBox.prompt('请输入项目名称以确认删除', '确认删除', {
      inputPlaceholder: project.name,
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
      inputValidator: (value: string) => value === project.name || '项目名称不匹配',
    });
  } catch {
    return;
  }
  await projectApi.remove(project.id);
  ElMessage.success('项目已删除');
  await fetch();
  void projectStore.refresh();
}

function openProject(id: string): void {
  void router.push(`/projects/${id}`);
}

onMounted(fetch);
</script>

<style scoped>
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  min-height: 200px;
}

.project-card {
  padding: 18px;
  transition: box-shadow 0.2s ease;
}

.project-card:hover {
  box-shadow: var(--dms-shadow-lg);
}

.project-card-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.project-icon {
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

.project-info {
  min-width: 0;
}

.project-name {
  font-weight: 600;
  font-size: 15px;
}

.project-desc {
  color: var(--dms-text-secondary);
  font-size: 13px;
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-stats {
  color: var(--dms-text-muted);
  font-size: 12px;
  margin-top: 12px;
}

.project-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  justify-content: flex-end;
}
</style>
