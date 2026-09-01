import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import MainLayout from '@/layouts/MainLayout.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/',
      component: MainLayout,
      redirect: '/projects',
      children: [
        {
          path: 'projects',
          name: 'projects',
          component: () => import('@/views/ProjectListView.vue'),
          meta: { title: '项目管理', permission: 'project:read' },
        },
        {
          path: 'projects/:id',
          name: 'project-detail',
          component: () => import('@/views/ProjectDetailView.vue'),
          meta: { title: '项目详情', permission: 'table:read' },
        },
        {
          path: 'tables/:id',
          name: 'table',
          component: () => import('@/views/TableView.vue'),
          meta: { title: '数据表', permission: 'record:read' },
        },
        {
          path: 'users',
          name: 'users',
          component: () => import('@/views/UsersView.vue'),
          meta: { title: '用户管理', permission: 'user:manage' },
        },
        {
          path: 'roles',
          name: 'roles',
          component: () => import('@/views/RolesView.vue'),
          meta: { title: '角色管理', permission: 'role:manage' },
        },
        {
          path: 'api-keys',
          name: 'api-keys',
          component: () => import('@/views/ApiKeysView.vue'),
          meta: { title: 'API 密钥', permission: 'api-key:read' },
        },
        {
          path: 'audit',
          name: 'audit',
          component: () => import('@/views/AuditView.vue'),
          meta: { title: '审计日志', permission: 'audit:read' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue'),
          meta: { title: '个人设置' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/projects' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  if (to.meta.public) {
    return true;
  }

  // 首次进入时尝试恢复会话（Refresh Token Cookie）
  if (!auth.ready) {
    await auth.bootstrap();
  }
  if (!auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  const permission = to.meta.permission as string | undefined;
  if (permission && !auth.can(permission)) {
    return { name: 'projects' };
  }
  return true;
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? '')} - 多维数据管理系统`;
});

export default router;
