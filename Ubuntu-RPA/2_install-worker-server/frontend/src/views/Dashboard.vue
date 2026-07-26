<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-lg font-semibold text-zinc-300 uppercase tracking-wider">Dashboard</h2>
      <span class="text-xs font-mono text-zinc-600">auto-refresh 10s</span>
    </div>

    <!-- Stats Cards（点击跳到 Jobs 对应筛选） -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
      <StatsCard :icon="ListChecks"  :value="stats.total"     label="Total"     iconClass="text-zinc-400"    @click="goJobs('ALL')" />
      <StatsCard :icon="Loader"      :value="stats.running"   label="Running"   iconClass="text-amber-500"   @click="goJobs('RUNNING')" />
      <StatsCard :icon="Clock"       :value="stats.pending"   label="Pending"   iconClass="text-zinc-500"    @click="goJobs('PENDING')" />
      <StatsCard :icon="CheckCircle" :value="stats.completed" label="Completed" iconClass="text-emerald-500" @click="goJobs('COMPLETED')" />
      <StatsCard :icon="XCircle"     :value="stats.failed"    label="Failed"    iconClass="text-red-500"     @click="goJobs('FAILED')" />
    </div>

    <!-- Success Rate Bar -->
    <div class="bg-zinc-900 border border-zinc-800 rounded p-4 mb-6">
      <div class="flex justify-between items-center mb-2">
        <span class="text-xs font-mono text-zinc-500 uppercase tracking-wider">Success Rate</span>
        <span class="text-sm font-mono font-semibold" :class="stats.successRate >= 80 ? 'text-emerald-400' : stats.successRate >= 50 ? 'text-amber-400' : 'text-red-400'">
          {{ stats.successRate }}%
        </span>
      </div>
      <div class="w-full bg-zinc-800 rounded h-1.5">
        <div
          class="h-1.5 rounded transition-all duration-500"
          :class="stats.successRate >= 80 ? 'bg-emerald-500' : stats.successRate >= 50 ? 'bg-amber-500' : 'bg-red-500'"
          :style="{ width: stats.successRate + '%' }"
        ></div>
      </div>
    </div>

    <!-- Recent Jobs -->
    <div class="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
      <div class="px-5 py-3 border-b border-zinc-800 flex justify-between items-center">
        <h3 class="text-xs font-mono text-zinc-500 uppercase tracking-wider">Recent Jobs</h3>
        <router-link to="/jobs" class="text-xs text-amber-500 hover:text-amber-400 font-mono">
          ALL &rarr;
        </router-link>
      </div>
      <div v-if="loading && recentJobs.length === 0" class="p-5 space-y-3">
        <div v-for="i in 5" :key="i" class="skeleton h-8 w-full"></div>
      </div>
      <div v-else-if="recentJobs.length === 0" class="p-8 text-center text-zinc-600 font-mono text-sm">No jobs</div>
      <table v-else class="w-full">
        <thead>
          <tr class="text-left text-xs font-mono text-zinc-600 uppercase border-b border-zinc-800">
            <th class="px-5 py-2.5">Name</th>
            <th class="px-5 py-2.5">Status</th>
            <th class="px-5 py-2.5">Tags</th>
            <th class="px-5 py-2.5">Started</th>
            <th class="px-5 py-2.5">Duration</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-800/50">
          <tr
            v-for="job in recentJobs"
            :key="job.id"
            class="hover:bg-zinc-800/50 cursor-pointer transition-colors"
            @click="$router.push(`/jobs/${job.id}`)"
          >
            <td class="px-5 py-3">
              <span class="font-medium text-zinc-200 text-sm">{{ job.name || 'Unnamed' }}</span>
            </td>
            <td class="px-5 py-3">
              <StatusBadge :status="job.state?.type || 'PENDING'" />
            </td>
            <td class="px-5 py-3">
              <span
                v-for="tag in (job.tags || []).slice(0, 3)"
                :key="tag"
                class="inline-block bg-zinc-800 text-zinc-500 text-xs font-mono px-1.5 py-0.5 rounded mr-1"
              >{{ tag }}</span>
            </td>
            <td class="px-5 py-3 text-sm font-mono text-zinc-500">
              {{ formatTime(job.start_time || job.expected_start_time) }}
            </td>
            <td class="px-5 py-3 text-sm font-mono text-zinc-500">
              {{ formatDuration(job.start_time, job.end_time) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ListChecks, Loader, Clock, CheckCircle, XCircle } from 'lucide-vue-next'
import { useJobsStore } from '../stores/jobs'
import StatsCard from '../components/StatsCard.vue'
import StatusBadge from '../components/StatusBadge.vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const store = useJobsStore()
const router = useRouter()
const { loading } = store
const stats = computed(() => store.stats)
const recentJobs = computed(() => store.jobs.slice(0, 10))
let refreshTimer = null

function goJobs(filter) {
  router.push({ path: '/jobs', query: filter === 'ALL' ? {} : { filter } })
}

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
  refreshTimer = setInterval(() => store.fetchJobs(), 10000)
})

onUnmounted(() => {
  clearInterval(refreshTimer)
})
</script>
