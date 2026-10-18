/**
 * VIBRO NDT Interactive B2B ROI & Triage Economics Calculator
 */

function formatNumber(num) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(num));
}

function updateRoiCalculation() {
  const nodesInput = document.getElementById('inputNodesCount');
  const hourlyRateInput = document.getElementById('inputHourlyRate');
  const defectPercentInput = document.getElementById('inputDefectRate');

  const nodes = parseInt(nodesInput.value, 10) || 1000;
  const hourlyRate = parseInt(hourlyRateInput.value, 10) || 12000;
  const defectRate = parseFloat(defectPercentInput.value) / 100 || 0.08; // 8% defects default

  // Display slider dynamic labels
  document.getElementById('lblNodesCount').textContent = `${formatNumber(nodes)} узлов`;
  document.getElementById('lblHourlyRate').textContent = `${formatNumber(hourlyRate)} ₸/час`;
  document.getElementById('lblDefectRate').textContent = `${Math.round(defectRate * 100)}%`;

  // 1. Traditional 100% Manual Ultrasonic (УЗК)
  // 10 minutes per node = 1/6 hour
  const timePerNodeHoursTrad = 10 / 60; // 0.1667 hr
  const totalHoursTrad = nodes * timePerNodeHoursTrad;
  const laborCostTrad = totalHoursTrad * hourlyRate;
  const consumablesCostTrad = nodes * 350; // acoustic gel, sandpaper, cleaning rag
  const totalCostTrad = laborCostTrad + consumablesCostCostTradFallback(consumablesCostTrad);

  // 2. VIBRO NDT Two-stage Triage Paradigm
  // Stage 1: 100% of nodes checked by VIBRO NDT (1 second = 0.00028 hr + 20 sec handling = 25 sec total = ~0.007 hr)
  const vibroSecondsPerNode = 25; // with repositioning
  const stage1Hours = (nodes * vibroSecondsPerNode) / 3600;
  const stage1Cost = stage1Hours * (hourlyRate * 0.45); // can be operated by junior technician

  // Stage 2: Heavy ultrasonic only on flagged suspicious nodes (defects + 2% false positives safety margin)
  const flaggedNodes = Math.ceil(nodes * (defectRate + 0.02));
  const stage2Hours = flaggedNodes * timePerNodeHoursTrad;
  const stage2Cost = stage2Hours * hourlyRate + (flaggedNodes * 350);

  const totalHoursVibro = stage1Hours + stage2Hours;
  const totalCostVibro = stage1Cost + stage2Cost;

  // 3. Comparison Metrics
  const hoursSaved = Math.max(0, totalHoursTrad - totalHoursVibro);
  const moneySaved = Math.max(0, totalCostTrad - totalCostVibro);
  const speedupRatio = (totalHoursTrad / Math.max(0.1, totalHoursVibro)).toFixed(1);

  // VIBRO NDT kit cost: 12 400 KZT
  const paybackTimeDays = Math.max(0.1, ((12400 / Math.max(1, moneySaved)) * 30)).toFixed(1);

  // Update UI DOM elements
  document.getElementById('resHoursTrad').textContent = `${Math.round(totalHoursTrad)} ч`;
  document.getElementById('resHoursVibro').textContent = `${Math.round(totalHoursVibro * 10) / 10} ч`;
  document.getElementById('resCostTrad').textContent = `${formatNumber(totalCostTrad)} ₸`;
  document.getElementById('resCostVibro').textContent = `${formatNumber(totalCostVibro)} ₸`;

  document.getElementById('resHoursSaved').textContent = `${Math.round(hoursSaved)} ч`;
  document.getElementById('resMoneySaved').textContent = `${formatNumber(moneySaved)} ₸`;
  document.getElementById('resSpeedupRatio').textContent = `${speedupRatio}x`;
  document.getElementById('resPayback').textContent = `${paybackTimeDays} дней`;
}

function consumablesCostCostTradFallback(c) {
  return c;
}

document.addEventListener('DOMContentLoaded', () => {
  const inputs = ['inputNodesCount', 'inputHourlyRate', 'inputDefectRate'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateRoiCalculation);
    }
  });

  updateRoiCalculation();
});
