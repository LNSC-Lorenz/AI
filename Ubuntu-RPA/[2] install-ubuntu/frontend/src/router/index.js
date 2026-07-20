import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../views/Dashboard.vue'),
  },
  {
    path: '/jobs',
    name: 'Jobs',
    component: () => import('../views/Jobs.vue'),
  },
  {
    path: '/jobs/:id',
    name: 'JobDetail',
    component: () => import('../views/JobDetail.vue'),
  },
  {
    path: '/deployments',
    name: 'Deployments',
    component: () => import('../views/Deployments.vue'),
  },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
