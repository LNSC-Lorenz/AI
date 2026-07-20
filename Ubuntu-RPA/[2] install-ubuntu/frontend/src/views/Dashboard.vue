<template>
  <div>
    <h2 class="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
      <StatsCard :icon="ListChecks"  :value="stats.total"     label="Total Jobs"    bgClass="bg-slate-50"   iconClass="text-slate-600" />
      <StatsCard :icon="Loader"      :value="stats.running"   label="Running"       bgClass="bg-blue-50"    iconClass="text-blue-600" />
      <StatsCard :icon="Clock"       :value="stats.pending"   label="Pending"       bgClass="bg-yellow-50"  iconClass="text-yellow-600" />
      <StatsCard :icon="CheckCircle" :value="stats.completed" label="Completed"     bgClass="bg-green-50"   iconClass="text-green-600" />
      <StatsCard :icon="XCircle"     :value="stats.failed"    label="Failed"        bgClass="bg-red-50"     iconClass="text-red-600" />
    </div>

    <!-- Success Rate Bar -->
    <div class="bg-white rounded-xl border border-gray-200 p-5 mb-8 shadow-sm">
      <div class="flex justify-between items-center mb-2">
        <span class="text-sm font-medium text-gray-700">Success Rate</span>
        <span class="text-sm font-bold" :class="stats.successRate >= 80 ? 'text-green-600' : stats.successRate >= 50 ? 'text-yellow-600' : 'text-red-600'">
          {{ stats.successRate }}%
        </span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-3">
        <div
          class="h-3 rounded-full transition-all duration-500"
          :class="stats.successRate >= 80 ? 'bg-green-500' : stats.successRate >= 50 ? 'bg-yellow-500' : 'bg-red-500'"
          :style="{ width: stats.successRate + '%' }"
        ></div>
      </div>
    </div>

    <!-- Recent Jobs -->
    <div class="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div class="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
        <h3 class="text-lg font-semibold text-gray-900">Recent Jobs</h3>
        <router-link to="/jobs" class="text-sm text-blue-600 hover:text-blue-800 font-medium">
          View All &rarr;
        </router-link>
      </div>
      <div v-if="loading" class="p-8 text-center text-gray-400">Loading...</div>
      <div v-else-if="recentJobs.length === 0" class="p-8 text-center text-gray-400">No jobs yet</div>
      <table v-else class="w-full">
        <thead>
          <tr class="text-left text-xs font-medium text-gray-500 uppercase border-b border-gray-100">
            <th class="px-5 py-3">Job Name</th>
            <th class="px-5 py-3">Status</th>
            <th class="px-5 py-3">Tags</th>
            <th class="px-5 py-3">Started</th>
            <th class="px-5 py-3">Duration</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr
            v-for="job in recentJobs"
            :key="job.id"
            class="hover:bg-gray-50 cursor-pointer transition-colors"
            @click="$router.push(`/jobs/${job.id}`)"
          >
            <td class="px-5 py-3.5">
              <span class="font-medium text-gray-900 text-sm">{{ job.name || 'Unnamed' }}</span>
            </td>
            <td class="px-5 py-3.5">
              <StatusBadge :status="job.state?.type || 'PENDING'" />
            </td>
            <td class="px-5 py-3.5">
              <span
                v-for="tag in (job.tags || []).slice(0, 3)"
                :key="tag"
                class="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded mr-1"
              >{{ tag }}</span>
            </td>
            <td class="px-5 py-3.5 text-sm text-gray-500">
              {{ formatTime(job.start_time || job.expected_start_time) }}
            </td>
            <td class="px-5 py-3.5 text-sm text-gray-500">
              {{ formatDuration(job.start_time, job.end_time) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { ListChecks, Loader, Clock, CheckCircle, XCircle } from 'lucide-vue-next'
import { useJobsStore } from '../stores/jobs'
import StatsCard from '../components/StatsCard.vue'
import StatusBadge from '../components/StatusBadge.vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const store = useJobsStore()
const { loading } = store
const stats = computed(() => store.stats)
const recentJobs = computed(() => store.jobs.slice(0, 10))

function formatTime(t) {
  return t ? dayjs(t).fromNow() : '-'
}

function formatDuration(start, end) {
  if (!start) return '-'
  const s = dayjs(start)
  const e = end ? dayjs(end) : dayjs()
  const sec = e.diff(s, 'second')
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

onMounted(() => {
  store.fetchJobs()
})
</script>
