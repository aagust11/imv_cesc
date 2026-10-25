import React, { useState, useMemo } from "react";
import { CESCProject, CESCQuestion } from "../types.js";
import { Users, TrendingUp, ShieldAlert, Award, Search, User, BarChart2, Eye, EyeOff } from "lucide-react";

interface SociogramViewProps {
  project: CESCProject;
}

export function SociogramView({ project }: SociogramViewProps) {
  const [selectedQuestionId, setSelectedQuestionId] = useState<number>(1);
  const [studentSearch, setStudentSearch] = useState<string>("");
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);

  // Parse responses into easily accessible statistics
  const responseList = useMemo(() => {
    return Object.values(project.responses || {});
  }, [project.responses]);

  const totalStudents = project.students.length;
  const totalSubmissions = responseList.length;
  const participationRate = totalStudents > 0 ? Math.round((totalSubmissions / totalStudents) * 100) : 0;

  // Compute votes count for each student per question
  // Structure: { [questionId]: { [studentName]: voteCount } }
  const votesData = useMemo(() => {
    const data: { [qId: number]: { [name: string]: number } } = {};
    
    // Initialize questions
    project.questions.forEach((q) => {
      data[q.id] = {};
      project.students.forEach((s) => {
        data[q.id][s] = 0;
      });
    });

    // Populate actual votes
    responseList.forEach((resp) => {
      Object.entries(resp.answers || {}).forEach(([qIdStr, selectedNames]) => {
        const qId = parseInt(qIdStr);
        if (data[qId]) {
          (selectedNames as string[]).forEach((chosenName) => {
            if (chosenName && project.students.includes(chosenName)) {
              data[qId][chosenName] = (data[qId][chosenName] || 0) + 1;
            }
          });
        }
      });
    });

    return data;
  }, [project.students, project.questions, responseList]);

  // Compute per-student profile of received votes
  const studentProfiles = useMemo(() => {
    const profiles: { [name: string]: { [qId: number]: number } } = {};
    
    project.students.forEach((s) => {
      profiles[s] = {};
      project.questions.forEach((q) => {
        profiles[s][q.id] = votesData[q.id]?.[s] || 0;
      });
    });

    return profiles;
  }, [project.students, project.questions, votesData]);

  // List of top voted students for the active question
  const topNominatedForQuestion = useMemo(() => {
    const votesForQ = votesData[selectedQuestionId] || {};
    return Object.entries(votesForQ)
      .map(([name, count]) => ({ name, count: count as number }))
      .sort((a, b) => b.count - a.count);
  }, [votesData, selectedQuestionId]);

  // Questions categorization for mental support
  // CESC standard behaviors: 
  // Prosocial (Help, Cheer): 4, 7
  // Aggression (Hit, Exclude, Rumors, Insults): 3, 5, 6, 8
  // Victimization (Gets hit, Gets insulted, Excluded): 9, 10, 11
  // Sociometric (Like, Dislike, Friends): 1, 2, 12
  const getQuestionBadge = (qId: number) => {
    switch (qId) {
      case 1: case 12:
        return { label: "Elecció Positiva", style: "bg-emerald-50 text-emerald-700 border-emerald-100" };
      case 2:
        return { label: "Elecció Negativa", style: "bg-rose-50 text-rose-700 border-rose-100" };
      case 4: case 7:
        return { label: "Prosociabilitat (Lideratge)", style: "bg-blue-50 text-blue-700 border-blue-100" };
      case 3: case 5: case 6: case 8:
        return { label: "Agressivitat (Observat)", style: "bg-amber-50 text-amber-700 border-amber-100" };
      case 9: case 10: case 11:
        return { label: "Vulnerabilitat / Victimització", style: "bg-purple-50 text-purple-700 border-purple-100" };
      default:
        return { label: "CESC Standàrd", style: "bg-slate-50 text-slate-700 border-slate-100" };
    }
  };

  const activeQuestion = project.questions.find((q) => q.id === selectedQuestionId);

  // Filter student list to analyze profiles
  const filteredStudentsForAnalysis = project.students.filter((s) =>
    s.toLowerCase().includes(studentSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* 1. Global statistics header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="flex items-center p-4 bg-white border-4 border-slate-900 shadow-[4px_4px_0px_rgba(0,0,0,1)]">
          <div className="p-3 mr-4 bg-indigo-100 text-indigo-750 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
            <Users className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Participació Alumnat</p>
            <p className="text-2xl font-black text-slate-900">
              {totalSubmissions} / {totalStudents} <span className="text-xs font-black text-indigo-700 bg-indigo-50 border border-slate-500 px-1.5 py-0.5 ml-1">({participationRate}%)</span>
            </p>
          </div>
        </div>

        <div className="flex items-center p-4 bg-white border-4 border-slate-900 shadow-[4px_4px_0px_rgba(0,0,0,1)]">
          <div className="p-3 mr-4 bg-emerald-100 text-emerald-700 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
            <Award className="w-6 h-6" />
          </div>
          <div className="overflow-hidden">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Màxim Nominat Prosocial</p>
            <p className="text-sm font-black text-emerald-750 truncate max-w-full" title="Màxim prosocial detectat">
              {useMemo(() => {
                // Combine Q4 (Ajuda els altres) and Q7 (Anima els altres)
                const prosocial = project.students.map((s) => ({
                  name: s,
                  votes: (votesData[4]?.[s] || 0) + (votesData[7]?.[s] || 0)
                })).sort((a, b) => b.votes - a.votes);
                return prosocial[0] && prosocial[0].votes > 0 ? `${prosocial[0].name} (${prosocial[0].votes} vots)` : "Cap encara";
              }, [project.students, votesData])}
            </p>
          </div>
        </div>

        <div className="flex items-center p-4 bg-white border-4 border-slate-900 shadow-[4px_4px_0px_rgba(0,0,0,1)]">
          <div className="p-3 mr-4 bg-rose-100 text-rose-700 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
            <ShieldAlert className="w-6 h-6 animate-bounce" />
          </div>
          <div className="overflow-hidden">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Alerta Victimització</p>
            <p className="text-sm font-black text-rose-650 truncate max-w-full">
              {useMemo(() => {
                // Combine Q9, Q10, Q11 (gets hit, gets insulted, gets excluded)
                const victims = project.students.map((s) => ({
                  name: s,
                  votes: (votesData[9]?.[s] || 0) + (votesData[10]?.[s] || 0) + (votesData[11]?.[s] || 0)
                })).sort((a, b) => b.votes - a.votes);
                return victims[0] && victims[0].votes > 0 ? `${victims[0].name} (${victims[0].votes} vots)` : "Cap alerta";
              }, [project.students, votesData])}
            </p>
          </div>
        </div>
      </div>

      {totalSubmissions === 0 ? (
        <div className="p-10 text-center bg-slate-100 border-4 border-dashed border-slate-900 shadow-[6px_6px_0px_rgba(0,0,0,1)]">
          <BarChart2 className="w-12 h-12 text-slate-900 mx-auto mb-3" />
          <h3 className="text-lg font-black uppercase italic text-slate-900">No hi ha respostes a analitzar encara</h3>
          <p className="text-sm font-semibold text-slate-600 mt-2 max-w-sm mx-auto">
            Quan els alumnes enviïn dades utilitzant el codi actiu del qüestionari, podràs avaluar el clima de l'aula aquí mateix en temps real.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT PANEL: SELECT QUESTION & SHOW TOP NOMINATIONS */}
          <div className="lg:col-span-7 bg-white p-5 border-4 border-slate-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] space-y-4">
            <div className="border-b-2 border-slate-900 pb-3">
              <h3 className="text-lg font-black uppercase italic text-slate-950 flex items-center gap-2">
                <BarChart2 className="text-indigo-600 w-5 h-5" />
                Nominacions per Pregunta
              </h3>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-tight mt-0.5">
                Selecciona una pregunta per veure quins alumnes han rebut el major nombre de nominacions per part dels seus companys.
              </p>
            </div>

            {/* Questions dropdown */}
            <div>
              <label className="block text-xs font-black text-slate-800 mb-1.5 uppercase tracking-wider">Pregunta de l'Anàlisi</label>
              <select
                value={selectedQuestionId}
                onChange={(e) => setSelectedQuestionId(parseInt(e.target.value))}
                className="w-full h-11 px-3 border-2 border-slate-900 text-slate-900 bg-white font-black focus:outline-none focus:bg-indigo-50"
              >
                {project.questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.id}. {q.text}
                  </option>
                ))}
              </select>
            </div>

            {activeQuestion && (
              <div className="p-4 bg-slate-50 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                  <span className="text-base font-black text-slate-900">{activeQuestion.id}. {activeQuestion.text}</span>
                  <span className={`px-2.5 py-1 text-xs font-black uppercase border-2 border-slate-900 shadow-[1px_1px_0px_rgba(0,0,0,1)] ${getQuestionBadge(activeQuestion.id).style}`}>
                    {getQuestionBadge(activeQuestion.id).label}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-650 leading-relaxed font-sans mt-2">{activeQuestion.description}</p>
              </div>
            )}

            {/* Nominations ranking table */}
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              <div className="flex text-xs font-black text-slate-500 px-3 uppercase tracking-wider">
                <span className="w-12">Pos.</span>
                <span className="flex-1">Alumne / Alumna</span>
                <span className="w-24 text-right">Vots Rebuts</span>
              </div>

              {topNominatedForQuestion.map((entry, index) => {
                const maxVotes = topNominatedForQuestion[0]?.count || 1;
                const percentage = Math.round((entry.count / maxVotes) * 100);
                
                // Alert styles based on the type of question
                let progressStyle = "bg-indigo-500";
                if (entry.count > 0) {
                  const qGroup = getQuestionBadge(selectedQuestionId).label;
                  if (qGroup.includes("Vulnerabilitat") || qGroup.includes("Negativa")) {
                    progressStyle = entry.count >= 4 ? "bg-rose-500" : entry.count >= 2 ? "bg-amber-400" : "bg-slate-500";
                  } else if (qGroup.includes("Prosociabilitat") || qGroup.includes("Positiva")) {
                    progressStyle = "bg-emerald-450";
                  }
                }

                return (
                  <div
                    key={index}
                    onClick={() => setSelectedStudent(entry.name)}
                    className={`flex items-center px-3 py-2.5 border-2 text-sm cursor-pointer transition-colors shadow-[2px_2px_0px_rgba(0,0,0,1)]
                      ${selectedStudent === entry.name ? "bg-indigo-50 border-slate-900 font-extrabold" : "bg-white hover:bg-slate-50 border-slate-200"}
                    `}
                  >
                    <span className="w-12 font-mono font-black text-slate-400">#{index + 1}</span>
                    <span className="flex-1 font-bold text-slate-800">{entry.name}</span>
                    <div className="w-32 flex items-center gap-3 border-l border-slate-200 pl-2">
                      <div className="flex-1 bg-slate-100 border border-slate-350 h-3 overflow-hidden hidden sm:block">
                        <div
                          className={`h-full border-r-2 border-slate-900 ${progressStyle}`}
                          style={{ width: `${entry.count > 0 ? percentage : 0}%` }}
                        />
                      </div>
                      <span className="w-10 text-right font-mono font-black text-slate-900 bg-slate-100 border border-slate-900 py-0.5 px-1.5 text-xs">
                        {entry.count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT PANEL: CHOOSE AND DEEPLY ANALYZE A SINGLE STUDENT PROFILE */}
          <div className="lg:col-span-5 bg-white p-5 border-4 border-slate-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] space-y-4">
            <div className="border-b-2 border-slate-900 pb-3">
              <h3 className="text-lg font-black uppercase italic text-slate-900 flex items-center gap-2">
                <User className="text-emerald-600 w-5 h-5" />
                Perfil Individual
              </h3>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-tight mt-0.5">
                Cerca o selecciona un alumne per veure el resum de la totalitat dels vots de l'aula que ha rebut en cada àmbit.
              </p>
            </div>

            {/* Quick search client */}
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4.5 h-4.5 text-slate-800" />
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Cerca alumne per analitzar..."
                className="w-full h-10 pl-9 pr-3 border-2 border-slate-900 text-sm bg-white focus:outline-none focus:bg-indigo-50 font-bold"
              />
            </div>

            {/* Filtered list triggers */}
            {!selectedStudent && (
              <div className="max-h-48 overflow-y-auto border-2 border-slate-900 p-1 space-y-0.5 shadow-[2px_2px_0px_rgba(0,0,0,1)] bg-slate-50">
                {filteredStudentsForAnalysis.length > 0 ? (
                  filteredStudentsForAnalysis.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedStudent(s)}
                      className="w-full text-left px-3 py-1.5 text-xs font-extrabold text-slate-800 hover:bg-slate-205 rounded-none transition-colors border-b border-slate-200 uppercase"
                    >
                      {s}
                    </button>
                  ))
                ) : (
                  <div className="text-center py-4 text-xs text-slate-550 font-bold italic">Cap alumne coincideix</div>
                )}
              </div>
            )}

            {selectedStudent && (
              <div className="space-y-4">
                {/* Visual Header of the student profile */}
                <div className="flex items-center justify-between bg-white p-4 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 border-2 border-slate-900 bg-indigo-100 text-indigo-700 font-black flex items-center justify-center shadow-[1px_1px_0px_rgba(0,0,0,1)]">
                      {selectedStudent.charAt(0)}
                    </div>
                    <div>
                      <h4 className="font-black text-slate-900 text-sm uppercase leading-tight">{selectedStudent.split(",")[0]}</h4>
                      <p className="text-[10px] font-black text-slate-450 uppercase tracking-widest mt-0.5">Grup: {project.title}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedStudent(null)}
                    className="text-[10px] text-indigo-700 hover:text-indigo-900 font-black uppercase tracking-wider underline decoration-2 shrink-0 ml-1"
                  >
                    Canvia
                  </button>
                </div>

                {/* Received votes cards by badge */}
                <div className="space-y-2.5 max-h-110 overflow-y-auto pr-1">
                  <span className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1 text-[10px]">Sociograma detallat</span>
                  
                  {project.questions.map((q) => {
                    const votesCount = studentProfiles[selectedStudent]?.[q.id] || 0;
                    const badge = getQuestionBadge(q.id);
                    
                    // Alert style for counts > 3
                    const isHighAlert = (badge.label.includes("Vulnerabilitat") || badge.label.includes("Negativa") || badge.label.includes("Agressivitat")) && votesCount >= 3;

                    return (
                      <div
                        key={q.id}
                        onClick={() => setSelectedQuestionId(q.id)}
                        className={`p-3 border-2 cursor-pointer hover:bg-slate-50 transition-colors flex items-start gap-3 justify-between shadow-[2px_2px_0px_rgba(0,0,0,1)]
                          ${isHighAlert ? "bg-rose-55 border-rose-605 font-bold" : "bg-white border-slate-200"}
                          ${selectedQuestionId === q.id ? "border-slate-900 bg-indigo-50/70" : ""}
                        `}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black text-slate-900">{q.id}. {q.text}</span>
                            <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase border border-slate-905 shadow-[0.5px_0.5px_0px_rgba(0,0,0,1)] ${badge.style}`}>
                              {badge.label}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 font-bold leading-tight line-clamp-1">{q.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`inline-block text-xs font-mono font-black border border-slate-900 px-2 py-0.5 shadow-[1px_1px_0px_rgba(0,0,0,1)]
                            ${votesCount > 0 ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-400"}
                            ${isHighAlert ? "bg-rose-200 text-rose-900" : ""}
                          `}>
                            {votesCount} vots
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
