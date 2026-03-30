import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  LMS_CATEGORIES,
  LMS_CONTENT_TYPES,
  type LearningModule,
  type LearningPath,
  type ReferenceDocument,
} from "@shared/schema";
import { toDisplayString } from "@/lib/display-utils";
import {
  RiGraduationCapLine,
  RiSearchLine,
  RiAddLine,
  RiSparklingLine,
  RiTimeLine,
  RiCheckboxCircleLine,
  RiFileTextLine,
  RiQuestionLine,
  RiLoader4Line,
  RiBarChartBoxLine,
  RiTeamLine,
  RiArrowRightLine,
  RiDeleteBinLine,
  RiBookOpenLine,
  RiBookMarkedLine,
  RiUploadLine,
  RiInputMethodLine,
  RiArrowLeftLine,
  RiCloseLine,
  RiCheckLine,
  RiCloseCircleLine,
} from "@remixicon/react";

function difficultyColor(d?: string) {
  if (d === "beginner") return "bg-green-100 text-green-700";
  if (d === "advanced") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

function contentTypeIcon(type: string) {
  switch (type) {
    case "article":
      return <RiFileTextLine className="w-4 h-4" />;
    case "quiz":
      return <RiQuestionLine className="w-4 h-4" />;
    case "ai_generated":
      return <RiSparklingLine className="w-4 h-4" />;
    default:
      return <RiBookOpenLine className="w-4 h-4" />;
  }
}

function ModuleCard({
  module,
  onDelete,
  onView,
}: {
  module: LearningModule;
  onDelete?: () => void;
  onView?: () => void;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={onView}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {contentTypeIcon(module.contentType)}
              <h3 className="font-medium text-sm">{module.title}</h3>
              {!module.isPublished && (
                <Badge variant="outline" className="text-xs">
                  Draft
                </Badge>
              )}
              {module.isPlatformContent && (
                <Badge variant="secondary" className="text-xs">
                  Platform
                </Badge>
              )}
            </div>
            {module.description && (
              <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{toDisplayString(module.description)}</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {module.category && (
                <Badge variant="outline" className="text-xs">
                  {LMS_CATEGORIES.find((c) => c.value === module.category)?.label || module.category}
                </Badge>
              )}
              {module.difficulty && (
                <Badge className={`text-xs ${difficultyColor(module.difficulty)}`}>{module.difficulty}</Badge>
              )}
              {module.estimatedMinutes && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <RiTimeLine className="w-3 h-3" /> {module.estimatedMinutes} min
                </span>
              )}
              {module.quizQuestions && (module.quizQuestions as any[]).length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {(module.quizQuestions as any[]).length} questions
                </span>
              )}
            </div>
          </div>
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <RiDeleteBinLine className="w-4 h-4 text-muted-foreground" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Full module content viewer with markdown rendering and quiz taking */
function ModuleViewer({ module, onBack }: { module: LearningModule; onBack: () => void }) {
  const [showQuiz, setShowQuiz] = useState(false);

  const quizQuestions = module.quizQuestions as
    | Array<{ question: string; options: string[]; correctIndex: number; explanation?: string }>
    | undefined;
  const hasQuiz = quizQuestions && quizQuestions.length > 0;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        <RiArrowLeftLine className="w-4 h-4" /> Back to modules
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 mb-1">
            {contentTypeIcon(module.contentType)}
            <CardTitle className="text-lg">{module.title}</CardTitle>
            {!module.isPublished && <Badge variant="outline">Draft</Badge>}
          </div>
          {module.description && <CardDescription>{toDisplayString(module.description)}</CardDescription>}
          <div className="flex items-center gap-3 mt-2">
            {module.category && (
              <Badge variant="outline">
                {LMS_CATEGORIES.find((c) => c.value === module.category)?.label || module.category}
              </Badge>
            )}
            {module.difficulty && <Badge className={difficultyColor(module.difficulty)}>{module.difficulty}</Badge>}
            {module.estimatedMinutes && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <RiTimeLine className="w-4 h-4" /> {module.estimatedMinutes} min
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {module.content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">{module.content}</div>
          ) : (
            <p className="text-muted-foreground text-sm">No content available for this module.</p>
          )}
        </CardContent>
      </Card>

      {hasQuiz && !showQuiz && (
        <Card>
          <CardContent className="p-6 text-center">
            <RiQuestionLine className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <h3 className="font-medium mb-1">Knowledge Check</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Test your understanding with {quizQuestions.length} questions. You need 70% to pass.
            </p>
            <Button onClick={() => setShowQuiz(true)}>
              <RiQuestionLine className="w-4 h-4 mr-2" /> Start Quiz
            </Button>
          </CardContent>
        </Card>
      )}

      {hasQuiz && showQuiz && (
        <QuizTaker moduleId={module.id} questions={quizQuestions} onClose={() => setShowQuiz(false)} />
      )}
    </div>
  );
}

/** Interactive quiz component with answer selection and grading */
function QuizTaker({
  moduleId,
  questions,
  onClose,
}: {
  moduleId: string;
  questions: Array<{ question: string; options: string[]; correctIndex: number; explanation?: string }>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [answers, setAnswers] = useState<(number | null)[]>(new Array(questions.length).fill(null));
  const [results, setResults] = useState<any>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/lms/modules/${moduleId}/submit-quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: "self", answers }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed to submit quiz");
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data);
      if (data.passed) {
        toast({
          title: "Quiz passed!",
          description: `Score: ${data.score}% (${data.correctCount}/${data.totalQuestions})`,
        });
      } else {
        toast({
          title: "Keep studying",
          description: `Score: ${data.score}%. You need 70% to pass.`,
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const allAnswered = answers.every((a) => a !== null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <RiQuestionLine className="w-4 h-4" />
            {results ? `Quiz Results: ${results.score}%` : `Quiz (${questions.length} questions)`}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <RiCloseLine className="w-4 h-4" />
          </Button>
        </div>
        {results && (
          <div className="mt-2">
            <Progress value={results.score} className="h-2" />
            <p className="text-sm mt-1">
              {results.passed ? (
                <span className="text-green-600 font-medium">
                  Passed! {results.correctCount}/{results.totalQuestions} correct
                </span>
              ) : (
                <span className="text-red-600 font-medium">
                  Not passed. {results.correctCount}/{results.totalQuestions} correct (need 70%)
                </span>
              )}
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {questions.map((q, qi) => {
          const result = results?.results?.[qi];
          return (
            <div key={qi} className="space-y-2">
              <p className="font-medium text-sm">
                {qi + 1}. {q.question}
                {result &&
                  (result.correct ? (
                    <RiCheckLine className="w-4 h-4 inline ml-2 text-green-600" />
                  ) : (
                    <RiCloseCircleLine className="w-4 h-4 inline ml-2 text-red-500" />
                  ))}
              </p>
              <div className="space-y-1.5 pl-4">
                {q.options.map((opt, oi) => {
                  const isSelected = answers[qi] === oi;
                  const isCorrect = result && oi === result.correctIndex;
                  const isWrong = result && isSelected && !result.correct;

                  let optClass = "border rounded-md p-2 text-sm cursor-pointer transition-colors ";
                  if (result) {
                    if (isCorrect) optClass += "border-green-500 bg-green-50 dark:bg-green-950";
                    else if (isWrong) optClass += "border-red-500 bg-red-50 dark:bg-red-950";
                    else optClass += "border-muted opacity-60";
                  } else {
                    optClass += isSelected ? "border-primary bg-primary/5" : "border-muted hover:border-primary/50";
                  }

                  return (
                    <div
                      key={oi}
                      className={optClass}
                      onClick={() => {
                        if (results) return; // Don't allow changes after submission
                        const newAnswers = [...answers];
                        newAnswers[qi] = oi;
                        setAnswers(newAnswers);
                      }}
                    >
                      <span className="font-mono text-xs mr-2">{String.fromCharCode(65 + oi)}.</span>
                      {opt}
                    </div>
                  );
                })}
              </div>
              {result && result.explanation && (
                <p className="text-xs text-muted-foreground pl-4 mt-1 italic">{result.explanation}</p>
              )}
            </div>
          );
        })}

        {!results && (
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!allAnswered || submitMutation.isPending}
            className="w-full"
          >
            {submitMutation.isPending ? (
              <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RiCheckboxCircleLine className="w-4 h-4 mr-2" />
            )}
            Submit Quiz
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CreateModuleForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [difficulty, setDifficulty] = useState("intermediate");
  const [estimatedMinutes, setEstimatedMinutes] = useState("10");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/lms/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          content,
          category,
          difficulty,
          contentType: "article",
          estimatedMinutes: parseInt(estimatedMinutes) || 10,
          isPublished: false,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Module created", description: "You can now publish it when ready" });
      setTitle("");
      setDescription("");
      setContent("");
      queryClient.invalidateQueries({ queryKey: ["/api/lms/modules"] });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <RiAddLine className="w-4 h-4" /> Create Learning Module
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Module title" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LMS_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Difficulty</Label>
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Estimated Minutes</Label>
            <Input type="number" value={estimatedMinutes} onChange={(e) => setEstimatedMinutes(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Content (Markdown)</Label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="Write your training content in Markdown..."
            className="font-mono text-sm"
          />
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !title.trim()}>
          {createMutation.isPending ? (
            <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RiAddLine className="w-4 h-4 mr-2" />
          )}
          Create Module
        </Button>
      </CardContent>
    </Card>
  );
}

function AIGenerateModule({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [selectedDoc, setSelectedDoc] = useState("");
  const [category, setCategory] = useState("general");
  const [generateQuiz, setGenerateQuiz] = useState(true);

  const { data: refDocs = [] } = useQuery<ReferenceDocument[]>({
    queryKey: ["/api/onboarding/reference-docs"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/lms/modules/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: selectedDoc, category, generateQuiz }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Module generated!", description: `"${data.title}" created from reference document` });
      queryClient.invalidateQueries({ queryKey: ["/api/lms/modules"] });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <RiSparklingLine className="w-4 h-4" /> AI-Generate from Reference Document
        </CardTitle>
        <CardDescription>
          Transform your uploaded reference documents into structured training modules with optional quizzes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {refDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reference documents uploaded yet. Upload documents in the Onboarding section first.
          </p>
        ) : (
          <>
            <div>
              <Label>Source Document *</Label>
              <Select value={selectedDoc} onValueChange={setSelectedDoc}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a document..." />
                </SelectTrigger>
                <SelectContent>
                  {refDocs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} ({d.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LMS_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={generateQuiz}
                    onChange={(e) => setGenerateQuiz(e.target.checked)}
                    className="rounded"
                  />
                  Generate quiz questions
                </label>
              </div>
            </div>
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !selectedDoc}>
              {generateMutation.isPending ? (
                <>
                  <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Generating (this may take 30-60s)...
                </>
              ) : (
                <>
                  <RiSparklingLine className="w-4 h-4 mr-2" /> Generate Training Module
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function KnowledgeSearch() {
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: results, isLoading } = useQuery<{
    modules: LearningModule[];
    knowledgeBase: Array<{ text: string; documentName: string; relevance: number }>;
    totalResults: number;
  }>({
    queryKey: ["/api/lms/knowledge-search", searchQuery],
    enabled: searchQuery.length >= 3,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <RiSearchLine className="w-4 h-4" /> Knowledge Base Search
        </CardTitle>
        <CardDescription>Search training modules and reference documents</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search for insurance codes, procedures, policies..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSearchQuery(query)}
          />
          <Button onClick={() => setSearchQuery(query)} disabled={query.length < 3}>
            <RiSearchLine className="w-4 h-4" />
          </Button>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RiLoader4Line className="w-4 h-4 animate-spin" /> Searching...
          </div>
        )}

        {results && (
          <div className="space-y-3">
            {results.modules.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <RiBookOpenLine className="w-3 h-3" /> Training Modules ({results.modules.length})
                </h4>
                {results.modules.map((m) => (
                  <ModuleCard key={m.id} module={m} />
                ))}
              </div>
            )}
            {results.knowledgeBase.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <RiFileTextLine className="w-3 h-3" /> Knowledge Base ({results.knowledgeBase.length})
                </h4>
                {results.knowledgeBase.map((kb, i) => (
                  <Card key={i} className="mb-2">
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground mb-1">
                        {kb.documentName} (relevance: {(kb.relevance * 100).toFixed(0)}%)
                      </div>
                      <p className="text-sm">{kb.text}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {results.totalResults === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No results found</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LearningPathsTab() {
  const { data: paths = [], isLoading } = useQuery<LearningPath[]>({
    queryKey: ["/api/lms/paths"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <RiLoader4Line className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (paths.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <RiBookMarkedLine className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-medium mb-1">No learning paths yet</h3>
          <p className="text-sm text-muted-foreground">
            Learning paths are curated sequences of modules. Create modules first, then organize them into paths.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {paths.map((path) => (
        <Card key={path.id} className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <RiBookMarkedLine className="w-4 h-4" />
                  <h3 className="font-medium text-sm">{path.title}</h3>
                  {path.isRequired && (
                    <Badge variant="destructive" className="text-xs">
                      Required
                    </Badge>
                  )}
                </div>
                {path.description && <p className="text-xs text-muted-foreground mb-2">{path.description}</p>}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{path.moduleIds.length} modules</span>
                  {path.estimatedMinutes && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <RiTimeLine className="w-3 h-3" /> {path.estimatedMinutes} min
                    </span>
                  )}
                  {path.category && (
                    <Badge variant="outline" className="text-xs">
                      {path.category}
                    </Badge>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm">
                <RiArrowRightLine className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StatsOverview() {
  const { data: stats } = useQuery<{
    totalModules: number;
    publishedModules: number;
    aiGeneratedModules: number;
    totalPaths: number;
    totalCompletions: number;
    totalInProgress: number;
    avgQuizScore: number | null;
    totalEmployeesLearning: number;
    modulesByCategory: Record<string, number>;
  }>({
    queryKey: ["/api/lms/stats"],
  });

  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <RiBookOpenLine className="w-4 h-4" />
            <span className="text-xs font-medium">Modules</span>
          </div>
          <div className="text-2xl font-bold">{stats.publishedModules}</div>
          <div className="text-xs text-muted-foreground">{stats.totalModules - stats.publishedModules} drafts</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <RiSparklingLine className="w-4 h-4" />
            <span className="text-xs font-medium">AI-Generated</span>
          </div>
          <div className="text-2xl font-bold">{stats.aiGeneratedModules}</div>
          <div className="text-xs text-muted-foreground">from reference docs</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <RiCheckboxCircleLine className="w-4 h-4" />
            <span className="text-xs font-medium">Completions</span>
          </div>
          <div className="text-2xl font-bold text-green-600">{stats.totalCompletions}</div>
          <div className="text-xs text-muted-foreground">{stats.totalInProgress} in progress</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <RiTeamLine className="w-4 h-4" />
            <span className="text-xs font-medium">Learners</span>
          </div>
          <div className="text-2xl font-bold">{stats.totalEmployeesLearning}</div>
          <div className="text-xs text-muted-foreground">active employees</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <RiBarChartBoxLine className="w-4 h-4" />
            <span className="text-xs font-medium">Avg Quiz Score</span>
          </div>
          <div className="text-2xl font-bold">{stats.avgQuizScore != null ? `${stats.avgQuizScore}%` : "--"}</div>
          <div className="text-xs text-muted-foreground">{Object.keys(stats.modulesByCategory).length} categories</div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LearningPage() {
  const [activeTab, setActiveTab] = useState("modules");
  const [viewingModule, setViewingModule] = useState<LearningModule | null>(null);
  const { toast } = useToast();

  const { data: modules = [], isLoading } = useQuery<LearningModule[]>({
    queryKey: ["/api/lms/modules"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/lms/modules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lms/modules"] });
      toast({ title: "Module deleted" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/lms/modules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: true }),
      });
      if (!res.ok) throw new Error("Failed to publish");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lms/modules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lms/stats"] });
      toast({ title: "Module published" });
    },
  });

  // If viewing a specific module, show the viewer
  if (viewingModule) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RiGraduationCapLine className="w-6 h-6" /> Learning Center
          </h1>
        </div>
        <ModuleViewer module={viewingModule} onBack={() => setViewingModule(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <RiGraduationCapLine className="w-6 h-6" />
          Learning Center
        </h1>
        <p className="text-muted-foreground text-sm">
          Training modules, knowledge base, and learning paths for your team.
        </p>
      </div>

      <StatsOverview />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="modules" className="gap-1.5">
            <RiBookOpenLine className="w-4 h-4" /> Modules ({modules.length})
          </TabsTrigger>
          <TabsTrigger value="paths" className="gap-1.5">
            <RiBookMarkedLine className="w-4 h-4" /> Paths
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-1.5">
            <RiAddLine className="w-4 h-4" /> Create
          </TabsTrigger>
          <TabsTrigger value="ai-generate" className="gap-1.5">
            <RiSparklingLine className="w-4 h-4" /> AI Generate
          </TabsTrigger>
          <TabsTrigger value="search" className="gap-1.5">
            <RiSearchLine className="w-4 h-4" /> Knowledge Search
          </TabsTrigger>
        </TabsList>

        <TabsContent value="modules" className="mt-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <RiLoader4Line className="w-6 h-6 animate-spin" />
            </div>
          ) : modules.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <RiGraduationCapLine className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium mb-1">No learning modules yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create modules manually or AI-generate them from your reference documents.
                </p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={() => setActiveTab("create")}>
                    <RiAddLine className="w-4 h-4 mr-2" /> Create Manually
                  </Button>
                  <Button onClick={() => setActiveTab("ai-generate")}>
                    <RiSparklingLine className="w-4 h-4 mr-2" /> AI Generate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            modules.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <div className="flex-1">
                  <ModuleCard
                    module={m}
                    onDelete={() => deleteMutation.mutate(m.id)}
                    onView={() => setViewingModule(m)}
                  />
                </div>
                {!m.isPublished && (
                  <Button size="sm" variant="outline" onClick={() => publishMutation.mutate(m.id)}>
                    Publish
                  </Button>
                )}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="paths" className="mt-4">
          <LearningPathsTab />
        </TabsContent>

        <TabsContent value="create" className="mt-4">
          <CreateModuleForm onSuccess={() => setActiveTab("modules")} />
        </TabsContent>

        <TabsContent value="ai-generate" className="mt-4">
          <AIGenerateModule onSuccess={() => setActiveTab("modules")} />
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <KnowledgeSearch />
        </TabsContent>
      </Tabs>
    </div>
  );
}
