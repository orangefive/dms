<template>
  <el-container class="app-layout">
    <el-aside :width="collapsed ? '64px' : '232px'" class="app-aside">
      <div class="brand" @click="goHome">
        <div class="brand-mark">D</div>
        <span v-if="!collapsed" class="brand-name">多维数据管理</span>
      </div>

      <el-scrollbar class="aside-scroll">
        <el-menu :default-active="activeMenu" :collapse="collapsed" class="aside-menu" router>
          <el-menu-item index="/projects">
            <el-icon><Grid /></el-icon>
            <template #title>项目</template>
          </el-menu-item>

          <template v-if="projectStore.loaded">
            <el-sub-menu v-for="project in projectStore.projects" :key="project.id" :index="`p-${project.id}`">
              <template #title>
                <el-icon><Folder /></el-icon>
                <span class="project-name">{{ project.name }}</span>
              </template>
              <el-menu-item
                v-for="table in project.tables ?? []"
                :key="table.id"
                :index="`/tables/${table.id}`"
              >
                <el-icon>
                  <DataBoard v-if="table.tableType === 'SYSTEM'" />
                  <Connection v-else />
                </el-icon>
                <span>{{ table.name }}</span>
              </el-menu-item>
              <el-menu-item :index="`/projects/${project.id}`">
                <el-icon><Setting /></el-icon>
                <span>管理表</span>
              </el-menu-item>
            </el-sub-menu>
            <el-menu-item v-if="projectStore.projects.length === 0" index="/projects">
              <el-icon><Plus /></el-icon>
              <template #title>创建第一个项目</template>
            </el-menu-item>
          </template>
          <div v-else-if="projectStore.loading" class="aside-loading">加载中...</div>
        </el-menu>

        <div class="aside-section">
          <el-menu :default-active="activeMenu" :collapse="collapsed" class="aside-menu" router>
            <template v-if="auth.can('user:manage')">
              <el-menu-item index="/users">
                <el-icon><User /></el-icon>
                <template #title>用户管理</template>
              </el-menu-item>
              <el-menu-item index="/roles">
                <el-icon><Avatar /></el-icon>
                <template #title>角色管理</template>
              </el-menu-item>
            </template>
            <template v-if="auth.can('api-key:read')">
              <el-menu-item index="/api-keys">
                <el-icon><Key /></el-icon>
                <template #title>API 密钥</template>
              </el-menu-item>
            </template>
            <template v-if="auth.can('audit:read')">
              <el-menu-item index="/audit">
                <el-icon><Document /></el-icon>
                <template #title>审计日志</template>
              </el-menu-item>
            </template>
          </el-menu>
        </div>
      </el-scrollbar>
    </el-aside>

    <el-container class="app-main">
      <el-header class="app-header" height="56px">
        <div class="header-left">
          <el-button text class="collapse-btn" @click="collapsed = !collapsed">
            <el-icon :size="18"><Expand v-if="collapsed" /><Fold v-else /></el-icon>
          </el-button>
          <span class="header-title">{{ routeTitle }}</span>
        </div>
        <div class="header-right">
          <el-dropdown trigger="click" @command="onCommand">
            <div class="user-chip">
              <el-avatar :size="28" class="user-avatar">{{ avatarText }}</el-avatar>
              <span class="user-name">{{ auth.user?.displayName || auth.user?.username }}</span>
              <el-icon><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="settings">个人设置</el-dropdown-item>
                <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="app-content">
        <router-view v-slot="{ Component }">
          <keep-alive :max="3">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowDown,
  Avatar,
  Connection,
  DataBoard,
  Document,
  Expand,
  Fold,
  Folder,
  Grid,
  Key,
  Plus,
  Setting,
  User,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/projects';

const auth = useAuthStore();
const projectStore = useProjectStore();
const route = useRoute();
const router = useRouter();

const collapsed = ref(false);

const activeMenu = computed(() => {
  if (route.path.startsWith('/tables/')) {
    return route.path;
  }
  if (route.path.startsWith('/projects')) {
    return '/projects';
  }
  return route.path;
});

const routeTitle = computed(() => String(route.meta.title ?? ''));

const avatarText = computed(() => {
  const name = auth.user?.displayName || auth.user?.username || '?';
  return name.slice(0, 1).toUpperCase();
});

function goHome(): void {
  void router.push('/projects');
}

async function onCommand(command: string | number | object): Promise<void> {
  if (command === 'settings') {
    await router.push('/settings');
  } else if (command === 'logout') {
    await auth.logout();
    ElMessage.success('已退出登录');
    await router.replace('/login');
  }
}

onMounted(() => {
  if (!projectStore.loaded) {
    void projectStore.fetch(true);
  }
});

// 路由变化后静默刷新侧边栏项目树（新建项目/表后保持最新）
watch(
  () => route.path,
  () => {
    void projectStore.refresh();
  },
);
</script>

<style scoped>
.app-layout {
  height: 100%;
}

.app-aside {
  background: #ffffff;
  border-right: 1px solid var(--dms-border);
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease;
  overflow: hidden;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 12px;
  cursor: pointer;
  user-select: none;
}

.brand-mark {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--dms-primary), var(--dms-primary-strong));
  color: #fff;
  font-weight: 700;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.brand-name {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
}

.aside-scroll {
  flex: 1;
}

.aside-menu {
  border-right: none;
}

.aside-menu :deep(.el-menu-item),
.aside-menu :deep(.el-sub-menu__title) {
  height: 40px;
  line-height: 40px;
  border-radius: 6px;
  margin: 2px 8px;
}

.aside-menu :deep(.el-menu-item.is-active) {
  background: var(--dms-primary-weak);
  color: var(--dms-primary-strong);
  font-weight: 500;
}

.project-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
}

.aside-section {
  border-top: 1px solid var(--dms-border);
  padding-top: 6px;
}

.aside-loading {
  padding: 12px 20px;
  color: var(--dms-text-muted);
  font-size: 13px;
}

.app-main {
  min-width: 0;
}

.app-header {
  background: #ffffff;
  border-bottom: 1px solid var(--dms-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.collapse-btn {
  padding: 6px;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}

.user-chip:hover {
  background: var(--dms-bg);
}

.user-avatar {
  background: var(--dms-primary);
  font-size: 13px;
}

.user-name {
  font-size: 13px;
  color: var(--dms-text);
}

.app-content {
  padding: 0;
  overflow: auto;
  background: var(--dms-bg);
  display: flex;
  flex-direction: column;
}

.app-content > * {
  flex: 1;
  min-height: 0;
}
</style>
