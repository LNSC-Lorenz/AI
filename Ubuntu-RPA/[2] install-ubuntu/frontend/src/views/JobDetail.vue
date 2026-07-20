<template>
  <div>
    <!-- Back -->
    <button
      @click="$router.push('/jobs')"
      class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
    >
      <ArrowLeft class="w-4 h-4" /> Back to Jobs
    </button>

    <div v-if="loading" class="text-center py-12 text-gray-400">Loading job details...</div>

    <template v-else-if="job">
      <!-- Header -->
      <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6 shadow-sm">
        <div class="flex justify-between items-start">
          <div>
            <h2 class="text-2xl font-bold text-gray-900 mb-1">{{ job.name || 'Unnamed Job' }}</h2>
            <p class="text-sm text-gray-400 font-mono">{{ job.id }}</p>
          </div>
          <StatusBadge :status="job.state?.type || 'PENDING'" />
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6 pt-6 border-t border-gray-100">
          <div>
            <p class="text-xs font-medium text-gray-500 uppercase mb-1">Flow ID</p>
            <p class="text-sm font-mono text-gray-700">{{ job.flow_id?.slice(0, 12) || '-' }}</p>
          </div>
          <div>
            <p class="text-xs font-medium text-gray-500 uppercase mb-1">Deployment ID</p>
            <p class="text-sm font-mono text-gray-700">{{ job.deployment_id?.slice(0, 12) || '-' }}</p>
          </div>
          <div>
            <p class="text-xs font-medium text-gray-500 uppercase mb-1">Start Time</p>
            <p class="text-sm text-gray-700">{{ formatFull(job.start_time) }}</p>
          </div>
          <div>
            <p class="text-xs font-medium text-gray-500 uppercase mb-1">Duration</p>
            <p class="text-sm text-gray-700">{{ formatDuration(job.start_time, job.end_time) }}</p>
          </div>
        </div>
      </div>

      <!-- Tags -->
      <div v-if="job.tags?.length" class="mb-6">
        <h3 class="text-sm font-medium text-gray-500 mb-2">Tags</h3>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="tag in job.tags"
            :key="tag"
            class="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm font-medium"
          >{{ tag }}</span>
        </div>
      </div>

      <!-- Parameters -->
      <div v-if="job.parameters && Object.keys(job.parameters).length > 0" class="bg-white rounded-xl border border-gray-200 p-6 mb-6 shadow-sm">
        <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Settings class="w-5 h-5 text-gray-400" /> Parameters
        </h3>
        <div class="bg-gray-50 rounded-lg p-4 font-mono text-sm text-gray-700 overflow-x-auto">
          <pre>{{ JSON.stringify(job.parameters, null, 2) }}</pre>
        </div>
      </div>

      <!-- State History -->
      <div class="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <History class="w-5 h-5 text-gray-400" /> State Timeline
        </h3>
        <div v-if="job.state_details" class="space-y-3">
          <div class="flex items-center gap-3">
            <div class="w-3 h-3 rounded-full" :class="stateColor(job.state?.type)"></div>
            <div>
              <p class="text-sm font-medium text-gray-900">{{ job.state?.type }}</p>
              <p class="text-xs text-gray-400">{{ job.state?.message || 'No message' }}</p>
              <p class="text-xs text-gray-400">{{ formatFull(job.state?.timestamp) }}</p>
            </div>
          </div>
        </div>
        <div v-else class="text-sm text-gray-400">No state history available</div>
      </div>
    </template>

    <div v-else class="text-center py-12 text-gray-400">Job not found</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Settings, History } from 'lucide-vue-next'
import StatusBadge from '../components/StatusBadge.vue'
import api from '../api'
import dayjs from 'dayjs'

const route = useRoute()
const job = ref(null)
const loading = ref(true)

function formatFull(t) {
  return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-'
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

function stateColor(type) {
  const map = {
    COMPLETED: 'bg-green-500',
    FAILED: 'bg-red-500',
    RUNNING: 'bg-blue-500',
    PENDING: 'bg-yellow-500',
    SCHEDULED: 'bg-purple-500',
  }
  return map[type] || 'bg-gray-400'
}

onMounted(async () => {
  try {
    const res = await api.getJob(route.params.id)
    job.value = res.data
  } catch {
    job.value = null
  } finally {
    loading.value = false
  }
})
</script>
