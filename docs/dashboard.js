$(document).ready(async function () {
  const dataUrl = "https://raw.githubusercontent.com/jdeck88/ffcsa_scripts/main/localline/data/weekly_kpi.json";
  const startDate = new Date("2025-01-01");

  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`Failed to fetch weekly data: ${response.statusText}`);
    const jsonData = await response.json();

    const weeks = (jsonData.weeks || []).filter(week => {
      const endDateStr = week.dateRange.split(" to ")[1];
      return new Date(endDateStr) >= startDate;
    });

    if (weeks.length === 0) throw new Error("No data after Jan 1, 2025.");

    const totalSales = weeks.reduce((sum, w) => sum + parseFloat(w.data.totalSales || 0), 0);
    const totalWeeks = weeks.length;

    const totalCOGS = totalSales * 0.25;
    const grossProfit = totalSales - totalCOGS;
    const overhead = totalWeeks * 8000;
    const netProfit = grossProfit - overhead;
    const netMargin = (netProfit / totalSales) * 100;

    const kpis = [
      { label: "Revenue", value: totalSales },
      { label: "COGS (25%)", value: totalCOGS },
      { label: "Gross Profit", value: grossProfit },
      { label: "Overhead", value: overhead },
      { label: "Net Profit", value: netProfit },
      { label: "Net Profit Margin", value: `${netMargin.toFixed(1)}%` }
    ];

    const tbody = document.getElementById("tableBody");
    tbody.innerHTML = "";

    kpis.forEach(kpi => {
      const tr = document.createElement("tr");

      const tdLabel = document.createElement("td");
      tdLabel.textContent = kpi.label;
      tr.appendChild(tdLabel);

      const tdValue = document.createElement("td");
      tdValue.textContent =
        typeof kpi.value === "number"
          ? `$${kpi.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : kpi.value;
      tr.appendChild(tdValue);

      tbody.appendChild(tr);
    });

    $('#ffcsaDashboardTable').DataTable({
      autoWidth: false,
      scrollX: false,
      paging: false,
      searching: false,
      info: false,
      ordering: false
    });

    console.log("✅ YTD KPI data loaded and table initialized.");
  } catch (err) {
    console.error("❌ KPI loading error:", err);
  }
});

