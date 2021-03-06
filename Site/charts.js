
let canvas = null;
let ctx = null;
const now = new Date();
const now1 = now.setMinutes(now.getMinutes() + 1);
const now2 = now.setMinutes(now.getMinutes() + 2);
const now3 = now.setMinutes(now.getMinutes() + 4);
const now4 = now.setMonth(now.getMonth() + 1);
const chart_data = {
    datasets: [],
}
const config = {
    data : chart_data,
    options:{
        maintainAspectRatio: false,
        scales:{
            x:{
                type: "time",
                time:{
                    minUnit: "minute",
                    displayFormats:{
                        minute: "HH:mm",
                        hour: "M.D, H:00"
                    }
                }
            }
        }
    }
}

let chart = null;

function startChart(){
    console.log("Starting chart");
    canvas = document.getElementById("graphCanvas");
    ctx = canvas.getContext("2d");
    chart = new Chart(ctx, config);
}

function clearChart(){
    chart_data.datasets = [];
    chart.update();
}

function addChartDataset(name, data){
    chart_data.datasets.push({
        label: name,
        type: 'line',
        data: data,
        pointRadius: 1
    });
}

function updateChart(){
    const l = chart_data.datasets.length;
    for(let i = 0; i<l; i++){
        const colorValue = i/l*360;
        chart_data.datasets[i].pointBackgroundColor = `hsla(${colorValue}, 50%, 70%, 90%)`;
        chart_data.datasets[i].backgroundColor = `hsla(${colorValue}, 50%, 70%, 90%)`;
        chart_data.datasets[i].borderColor = `hsla(${colorValue}, 50%, 70%, 60%)`;
    }
    chart.update();
}