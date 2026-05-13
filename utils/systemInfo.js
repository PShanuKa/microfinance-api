import os from 'os';
import process from 'process';

export function getSystemInfo() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  
  return {
    memory: {
      total: `${(totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB`,
      used: `${(usedMemory / 1024 / 1024 / 1024).toFixed(2)} GB`,
      free: `${(freeMemory / 1024 / 1024 / 1024).toFixed(2)} GB`,
      usagePercentage: `${((usedMemory / totalMemory) * 100).toFixed(2)}%`,
    },
    cpu: {
      model: os.cpus()[0]?.model || 'Unknown',
      cores: os.cpus().length,
      speed: `${os.cpus()[0]?.speed || 0} MHz`,
      loadAverage: os.loadavg().map(load => load.toFixed(2)),
    },
    process: {
      nodeVersion: process.version,
      pid: process.pid,
      uptime: `${Math.floor(process.uptime())} seconds`,
      memoryUsage: {
        rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
        external: `${(process.memoryUsage().external / 1024 / 1024).toFixed(2)} MB`,
      },
    },
    system: {
      platform: os.platform(),
      architecture: os.arch(),
      hostname: os.hostname(),
      osType: os.type(),
      osRelease: os.release(),
    },
  };
}
