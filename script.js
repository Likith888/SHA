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
  fatigue:["fatigue","tiredness","weakness"]
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
              showResultHtml("✅ Datasets loaded")
              predictBtn.disabled=false
            })
          })
        })
      })
    })
  })
}

function buildMap(data){
  const map={}
  data.forEach(r=>{
    const d=clean(r.Disease||r.label||"")
    const s=splitSymptoms(r.Symptoms||r.text||"")
    if(!d) return
    if(!map[d]) map[d]=new Set()
    s.forEach(x=>map[d].add(x))
  })
  return Object.keys(map).map(k=>({disease:k,symptoms:[...map[k]]}))
}

function calculateScore(expanded, diseases){
  const scores={}

  diseases.forEach(d=>{
    let match=0

    expanded.forEach(s=>{
      let bestMatch=0

      d.symptoms.forEach(ds=>{
        if(ds.includes(s) || s.includes(ds)){
          bestMatch=2
        } else {
          const w1=s.split(" ")
          const w2=ds.split(" ")

          w1.forEach(a=>{
            w2.forEach(b=>{
              if(a===b){
                bestMatch=Math.max(bestMatch,1)
              }
            })
          })
        }
      })

      match += bestMatch
    })

    if(match>0){
      scores[d.disease]=(match/(expanded.length*2))*100
    }
  })

  return scores
}

function naiveBayesPredict(symptoms, diseases){

  const results=[]

  diseases.forEach(d=>{
    let matchCount=0

    symptoms.forEach(s=>{
      if(d.symptoms.some(ds=>ds.includes(s)||s.includes(ds))){
        matchCount++
      }
    })

    const prob = (matchCount + 1) / (symptoms.length + 2)

    results.push({
      disease:d.disease,
      probability:prob
    })
  })

  const total = results.reduce((sum,x)=>sum+x.probability,0)

  return results.map(x=>({
    disease:x.disease,
    probability:(x.probability/total)*100
  }))
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
  if(days>=3) avg+=1
  if(days>=7) avg+=2

  let level="low"
  if(avg>=5) level="medium"
  if(avg>=8) level="high"

  return {value:avg.toFixed(2),level}
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
    showResultHtml("⚠️ Fill all fields")
    return
  }

  const symptoms=splitSymptoms(raw)
  if(symptoms.length<2){
    showResultHtml("⚠️ Enter at least 2 symptoms")
    return
  }

  loading("Analyzing symptoms...")

  const expanded=expandSymptoms(symptoms)

  const map1=buildMap(diseaseData)
  const map2=buildMap(symptom2Disease)
  const map3=buildMap(extraData)

  const s1=calculateScore(expanded,map1)
  const s2=calculateScore(expanded,map2)
  const s3=calculateScore(expanded,map3)

  const finalScores={}

  function merge(src,w){
    Object.entries(src).forEach(([d,s])=>{
      finalScores[d]=(finalScores[d]||0)+s*w
    })
  }

  merge(s1,0.5)
  merge(s2,0.3)
  merge(s3,0.2)

  const maxScore=Math.max(...Object.values(finalScores))

  Object.keys(finalScores).forEach(d=>{
    finalScores[d]=(finalScores[d]/maxScore)*100
  })

  let ranked=Object.entries(finalScores)
    .map(([d,s])=>({disease:d,score:s}))
    .sort((a,b)=>b.score-a.score)
    .slice(0,3)

  const allDiseases=[...map1,...map2,...map3]

  const nbResults=naiveBayesPredict(expanded, allDiseases)

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
      <h3>${i===0?"⭐ ":""}${r.disease}</h3>
      <p>${r.score.toFixed(2)}%</p>
      <p>${d?d.Description:"No description available."}</p>
      <ul>${precautions.map(p=>`<li>${p}</li>`).join("")}</ul>
    </div>`
  })

  html+=`<h2>🧠 Naive Bayes</h2>`

  nbResults.forEach(r=>{
    html+=`<div>${r.disease} - ${r.probability.toFixed(2)}%</div>`
  })

  showResultHtml(html)

  lastReport={name,age,gender,history,symptoms,days,sev,ranked,nbResults}
  downloadBtn.disabled=false
}

document.addEventListener("DOMContentLoaded",()=>{
  initDatasets()
  predictBtn.onclick=predictDisease
  downloadBtn.onclick=downloadPDF
})

/* ✅ FINAL FIXED PDF FUNCTION */
function downloadPDF(){
  if(!lastReport){
    alert("No report to download")
    return
  }

  const {name, age, gender, history, symptoms, days, sev, ranked, nbResults} = lastReport

  const sevColor = sev.level==='high' ? '#C62828' : sev.level==='medium' ? '#E65100' : '#2E7D32'
  const sevBg    = sev.level==='high' ? '#FDECEA' : sev.level==='medium' ? '#FFF8E1' : '#E8F5E9'
  const sevBorder= sev.level==='high' ? '#EF9A9A' : sev.level==='medium' ? '#FFE082' : '#A5D6A7'
  const cardColors = ['#0D7377','#14BDAC','#7FCDCD']

  let diseasesHtml = ''

  ranked.forEach((r, i) => {
    const d = descData.find(x => clean(x.Disease) === r.disease)
    const precautions = getPrecautions(r.disease)
    const desc = d ? d.Description : 'No description available.'
    const col = cardColors[i]

    diseasesHtml += `
    <div style="border:1.5px solid ${col}; border-radius:10px; margin-bottom:12px; overflow:hidden; page-break-inside:avoid;">
      <div style="background:${col}; padding:9px 14px; display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#fff; font-weight:bold; font-size:11px; text-transform:capitalize;">
          ${i+1}.&nbsp;&nbsp;${r.disease.toUpperCase()}
        </span>
        <span style="background:rgba(255,255,255,0.22); color:#fff; font-size:10px;
          font-weight:bold; padding:2px 10px; border-radius:12px;">
          ${r.score.toFixed(2)}%
        </span>
      </div>
      <div style="padding:10px 14px; background:#F0FAFA;">
        <p style="font-size:9.5px; color:#333; margin:0 0 8px; line-height:1.6;">${desc}</p>
        <div style="font-size:9.5px; font-weight:bold; color:#0D7377; margin-bottom:5px;">Precautions:</div>
        <div style="padding-left:4px;">
          ${precautions.map(p => `
          <div style="font-size:9.5px; color:#555; margin-bottom:4px; display:flex; align-items:flex-start;">
            <span style="color:${col}; font-weight:bold; margin-right:6px; flex-shrink:0;">•</span>
            <span>${p}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>`
  })

  const nbRows = nbResults.map((r, i) => `
    <tr style="background:${i%2===0?'#fff':'#F0FAFA'};">
      <td style="padding:6px 10px; font-size:9.5px; color:#888;">${i+1}</td>
      <td style="padding:6px 10px; font-size:9.5px; color:#222; text-transform:capitalize;">${r.disease}</td>
      <td style="padding:6px 10px; font-size:9.5px; color:#0D7377; font-weight:bold; text-align:right;">${r.probability.toFixed(5)}</td>
    </tr>`).join('')

  const html = `
  <div style="font-family:Arial,sans-serif; padding:28px 30px; background:#fff; color:#000; max-width:720px; margin:0 auto;">

    <!-- HEADER -->
    <div style="background:linear-gradient(135deg,#0D7377,#14BDAC); padding:22px 20px 16px;
      border-radius:10px; text-align:center; margin-bottom:18px;">
      <div style="font-size:20px; font-weight:bold; color:#fff; letter-spacing:2px; line-height:1.3;">
        SMART HEALTHCARE REPORT
      </div>
      <div style="font-size:10px; color:#DFFAFA; margin-top:5px; letter-spacing:1px;">
        AI-Assisted Health Analysis
      </div>
    </div>

    <!-- PATIENT INFO -->
    <div style="background:#F0FAFA; border:1px solid #B2DFDB; border-radius:8px;
      padding:14px 16px; margin-bottom:16px;">
      <div style="font-size:11px; font-weight:bold; color:#0D7377; border-bottom:1px solid #B2DFDB;
        padding-bottom:6px; margin-bottom:10px; letter-spacing:0.8px;">
        PATIENT INFORMATION
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:9.5px;">
        <tr>
          <td style="padding:4px 8px 4px 0; color:#555; width:22%; font-weight:bold;">Name</td>
          <td style="padding:4px 12px 4px 0; color:#222; width:28%;">${name}</td>
          <td style="padding:4px 8px 4px 0; color:#555; width:18%; font-weight:bold;">Age</td>
          <td style="padding:4px 0; color:#222;">${age}</td>
        </tr>
        <tr>
          <td style="padding:4px 8px 4px 0; color:#555; font-weight:bold;">Gender</td>
          <td style="padding:4px 12px 4px 0; color:#222;">${gender}</td>
          <td style="padding:4px 8px 4px 0; color:#555; font-weight:bold;">Medical History</td>
          <td style="padding:4px 0; color:#222;">${history}</td>
        </tr>
        <tr>
          <td style="padding:4px 8px 4px 0; color:#555; font-weight:bold;">Symptoms</td>
          <td style="padding:4px 12px 4px 0; color:#222;" colspan="3">${symptoms.join(', ')}</td>
        </tr>
        <tr>
          <td style="padding:4px 8px 4px 0; color:#555; font-weight:bold;">Duration</td>
          <td style="padding:4px 12px 4px 0; color:#222;">${days} days</td>
          <td style="padding:4px 8px 4px 0; color:#555; font-weight:bold;">Severity</td>
          <td style="padding:4px 0;">
            <span style="background:${sevBg}; color:${sevColor}; border:1px solid ${sevBorder};
              padding:2px 10px; border-radius:10px; font-size:9px; font-weight:bold;">
              ${sev.value} (${sev.level.toUpperCase()})
            </span>
          </td>
        </tr>
      </table>
    </div>

    <!-- SECTION HEADER -->
    <div style="background:#E0F5F5; border:1px solid #14BDAC; border-radius:6px;
      padding:6px 12px; margin-bottom:10px;">
      <span style="font-size:11px; font-weight:bold; color:#0D7377; letter-spacing:0.8px;">
        TOP DISEASE PREDICTIONS
      </span>
    </div>

    <!-- DISEASE CARDS -->
    ${diseasesHtml}

    <!-- NAIVE BAYES SECTION -->
    <div style="background:#E0F5F5; border:1px solid #14BDAC; border-radius:6px;
      padding:6px 12px; margin-top:6px; margin-bottom:10px;">
      <span style="font-size:11px; font-weight:bold; color:#0D7377; letter-spacing:0.8px;">
        NAIVE BAYES PREDICTION
      </span>
    </div>

    <table style="width:100%; border-collapse:collapse; border:1px solid #B2DFDB; border-radius:8px; overflow:hidden; font-size:9.5px;">
      <thead>
        <tr style="background:#E0F5F5; border-bottom:2px solid #14BDAC;">
          <th style="padding:7px 10px; color:#555; font-weight:bold; text-align:left; width:10%;">#</th>
          <th style="padding:7px 10px; color:#555; font-weight:bold; text-align:left;">Disease</th>
          <th style="padding:7px 10px; color:#555; font-weight:bold; text-align:right;">Probability</th>
        </tr>
      </thead>
      <tbody>${nbRows}</tbody>
    </table>

    <!-- FOOTER -->
    <div style="text-align:center; margin-top:18px; padding-top:10px; border-top:1px solid #E0E0E0;">
      <span style="font-size:8.5px; color:#AAAAAA; font-style:italic;">
        AI-assisted report &bull; Not a medical diagnosis &bull; Consult a qualified healthcare professional
      </span>
    </div>

  </div>`

  const container = document.createElement('div')
  container.innerHTML = html

  html2pdf().set({
    margin: [8, 8, 8, 8],
    filename: `Health_Report_${name}.pdf`,
    image: { type: 'jpeg', quality: 1 },
    html2canvas: { scale: 3, useCORS: true, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  }).from(container).save()
}