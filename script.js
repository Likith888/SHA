let diseaseData=[],descData=[],precautionData=[],severityData=[],extraData=[],symptom2Disease=[]
let lastReport=null

function showResultHtml(html){
  document.getElementById("result").innerHTML=html
}

function loading(msg){
  showResultHtml(`<div class="loading"><div class="spinner"></div>${msg}</div>`)
}

function clean(t){
  return t ? t.toLowerCase().replace(/[^a-z0-9,\s]/g,"").trim() : ""
}

function splitSymptoms(s){
  return clean(s).split(",").map(x=>x.trim()).filter(Boolean)
}

const symptomSynonyms={
  fever:["fever","high fever","temperature"],
  cough:["cough","dry cough","wet cough"],
  headache:["headache","head pain"],
  fatigue:["fatigue","tiredness"]
}

function expandSymptoms(list){
  const out=new Set()
  list.forEach(s=>{
    out.add(s)
    Object.values(symptomSynonyms).forEach(a=>{
      if(a.includes(s)) a.forEach(x=>out.add(clean(x)))
    })
  })
  return [...out]
}

function safeParseCSV(p,cb){
  Papa.parse(p,{download:true,header:true,complete:r=>cb(r.data||[])})
}

function initDatasets(){
  loading("Loading medical datasets...")
  predictBtn.disabled=true

  safeParseCSV("DiseaseAndSymptoms.csv",d=>{
    diseaseData=d
    safeParseCSV("Symptom2Disease.csv",d2=>{
      symptom2Disease=d2
      safeParseCSV("symptom_Description.csv",d3=>{
        descData=d3
        safeParseCSV("symptom_precaution.csv",d4=>{
          precautionData=d4
          safeParseCSV("Symptom-severity.csv",d5=>{
            severityData=d5
            safeParseCSV("dataset.csv",d6=>{
              extraData=d6
              showResultHtml("✅ Datasets loaded. Enter patient details.")
              predictBtn.disabled=false
            })
          })
        })
      })
    })
  })
}

function buildDiseaseMap(){
  const map={}
  ;[].concat(diseaseData,symptom2Disease,extraData).forEach(r=>{
    const d=clean(r.Disease||r.label||"")
    const s=splitSymptoms(r.Symptoms||r.text||"")
    if(!map[d]) map[d]=new Set()
    s.forEach(x=>map[d].add(x))
  })
  return Object.keys(map).map(k=>({disease:k,symptoms:[...map[k]]}))
}

function naiveBayesPredict(symptoms, diseases){
  const results = {}
  diseases.forEach(d=>{
    let prob = 1
    symptoms.forEach(s=>{
      if(d.symptoms.includes(s)) prob *= 0.8
      else prob *= 0.2
    })
    results[d.disease] = prob
  })

  return Object.entries(results)
    .map(([d,p])=>({disease:d,probability:p}))
    .sort((a,b)=>b.probability-a.probability)
    .slice(0,3)
}

function calcSeverity(symptoms, days){
  const ex=expandSymptoms(symptoms)
  let total=0,count=0

  ex.forEach(s=>{
    const row=severityData.find(x=>clean(x.Symptom)===s)
    if(row){
      total+=parseInt(row.weight)
      count++
    }
  })

  if(!count) return {value:"N/A",level:"unknown"}

  let avg=(total/count)

  if(days >= 3 && days < 7) avg += 1
  if(days >= 7) avg += 2

  avg = avg.toFixed(2)

  let level="low"
  if(avg>=5 && avg<8) level="medium"
  if(avg>=8) level="high"

  return {value:avg,level}
}

function getPrecautions(disease){
  const row=precautionData.find(x=>clean(x.Disease)===disease)
  if(!row) return []
  return Object.keys(row)
    .filter(k=>k.toLowerCase().includes("precaution"))
    .map(k=>row[k])
    .filter(Boolean)
}

function predictDisease(){
  const name=nameInput.value.trim()
  const age=ageInput.value
  const gender=genderInput.value
  const history=historyInput.value.trim() || "None"
  const raw=symptomInput.value
  const days=daysInput.value

  if(!name||!age||!gender||!raw||!days){
    showResultHtml("⚠️ Please fill all required fields.")
    return
  }

  const symptoms=splitSymptoms(raw)
  if(symptoms.length<2){
    showResultHtml("⚠️ Enter at least two symptoms.")
    return
  }

  loading("Analyzing symptoms...")

  const expanded=expandSymptoms(symptoms)
  const diseases=buildDiseaseMap()

  const nbResults = naiveBayesPredict(expanded, diseases)

  const scores={}
  diseases.forEach(d=>{
    let match=0
    expanded.forEach(s=>{
      if(d.symptoms.some(x=>x.includes(s)||s.includes(x))) match++
    })
    if(match>0){
      const sc=(match/expanded.length)*100
      scores[d.disease]=Math.max(scores[d.disease]||0,sc)
    }
  })

  const ranked=Object.entries(scores)
    .map(([d,s])=>({disease:d,score:s}))
    .sort((a,b)=>b.score-a.score)
    .slice(0,3)

  const sev=calcSeverity(symptoms, days)

  let html=`
  <h2>🧑‍⚕️ Patient Summary</h2>
  <p><b>Name:</b> ${name}</p>
  <p><b>Age:</b> ${age}</p>
  <p><b>Gender:</b> ${gender}</p>
  <p><b>Medical History:</b> ${history}</p>
  <p><b>Symptoms:</b> ${symptoms.join(", ")}</p>
  <p><b>Symptoms Duration:</b> ${days} days</p>

  <p><b>Severity:</b>
    <span class="severity ${sev.level}">
      ${sev.value} (${sev.level.toUpperCase()})
    </span>
  </p>

  <h2>🩺 Disease Suggestions</h2>
  `

  ranked.forEach((r,i)=>{
    const d=descData.find(x=>clean(x.Disease)===r.disease)
    const precautions=getPrecautions(r.disease)

    html+=`
    <div class="disease-card">
      <h3>${i===0?"⭐ Most Likely: ":""}${r.disease}</h3>
      <p><b>Match:</b> ${r.score.toFixed(2)}%</p>
      <p>${d?d.Description:"No description available."}</p>
      <ul>${precautions.map(p=>`<li>${p}</li>`).join("")}</ul>
    </div>`
  })

  html += `<h2>🧠 Naive Bayes Prediction</h2>`

  nbResults.forEach((r,i)=>{
    html += `
    <div class="disease-card">
      <h3>${i===0?"⭐ Most Probable: ":""}${r.disease}</h3>
      <p>${r.probability.toFixed(5)}</p>
    </div>`
  })

  showResultHtml(html)
  lastReport={name,age,gender,history,sev,ranked,days}
  downloadBtn.disabled=false
}

/* FINAL CLEAN PDF (NO EMOJI BUG) */
function downloadPDF(){
  if(!lastReport) return

  const {jsPDF}=window.jspdf
  const doc=new jsPDF()

  let y=20

  // HEADER
  doc.setFont("helvetica","bold")
  doc.setFontSize(16)
  doc.text("SMART HEALTHCARE",10,15)

  doc.setFont("helvetica","normal")
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text("AI Assisted Medical Report",10,20)
  doc.setTextColor(0)

  // TITLE
  doc.setFontSize(18)
  doc.text("Health Report",105,25,{align:"center"})

  // LINE
  doc.setDrawColor(200)
  doc.line(10,30,200,30)

  // DETAILS
  doc.setFontSize(12)

  y=40
  doc.text(`Name: ${lastReport.name}`,10,y)
  doc.text(`Age: ${lastReport.age}`,10,y+=8)
  doc.text(`Gender: ${lastReport.gender}`,10,y+=8)
  doc.text(`History: ${lastReport.history}`,10,y+=8)
  doc.text(`Symptoms Duration: ${lastReport.days} days`,10,y+=8)

  // SEVERITY
  doc.setFont("helvetica","bold")
  doc.text(`Severity: ${lastReport.sev.value} (${lastReport.sev.level})`,10,y+=12)

  // PREDICTIONS
  doc.setFontSize(14)
  doc.text("Top Disease Predictions",10,y+=12)

  doc.setFontSize(11)
  doc.setFont("helvetica","normal")

  lastReport.ranked.forEach((d,i)=>{
    doc.text(`${i+1}. ${d.disease} (${d.score.toFixed(2)}%)`,10,y+=8)
  })

  // FOOTER
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text("AI-assisted report • Not a medical diagnosis",105,285,{align:"center"})

  doc.save("Health_Report.pdf")
}

document.addEventListener("DOMContentLoaded",()=>{
  initDatasets()
  predictBtn.onclick=predictDisease
  downloadBtn.onclick=downloadPDF
})