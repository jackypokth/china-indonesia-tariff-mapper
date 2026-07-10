import React, { useState, useEffect } from 'react';
import { Search, Loader2, Info, ArrowRightLeft, FileSearch, Anchor, AlertTriangle, CheckCircle, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchTariffMatches, useListTariffCodes, TariffSearchResult, TariffCode, Country } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';

export function HomePage() {
  const [activeTab, setActiveTab] = useState('search');

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">China–Indonesia Tariff Mapper</h1>
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-[300px]">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="search">Search</TabsTrigger>
              <TabsTrigger value="reference">Reference</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsContent value="search" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
            <SearchWorkspace />
          </TabsContent>
          <TabsContent value="reference" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
            <ReferenceWorkspace />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function SearchWorkspace() {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<'china_to_indonesia' | 'indonesia_to_china'>('china_to_indonesia');
  const [queryType, setQueryType] = useState<'description' | 'hs_code' | 'local_code'>('description');
  
  const searchMutation = useSearchTariffMatches();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    searchMutation.mutate({
      data: {
        query,
        queryType,
        direction,
      }
    });
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto">
      <div className="flex flex-col gap-2 mb-2">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">Harmonized Classification</h2>
        <p className="text-muted-foreground text-lg">Cross-reference customs declarations with confidence scores and statutory basis.</p>
      </div>

      <Card className="border-primary/20 shadow-sm rounded-xl overflow-hidden bg-card">
        <div className="bg-muted/50 p-4 border-b">
          <form onSubmit={handleSearch} className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
              <div className="grid gap-2 flex-1 w-full">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Search Term</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Enter product description, HS code..." 
                    className="pl-9 h-11 text-base shadow-sm focus-visible:ring-primary font-medium"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    data-testid="input-search-query"
                  />
                </div>
              </div>
              
              <div className="grid gap-2 w-full sm:w-48 shrink-0">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Input Type</label>
                <Select value={queryType} onValueChange={(val: any) => setQueryType(val)}>
                  <SelectTrigger className="h-11 shadow-sm" data-testid="select-query-type">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="description">Description</SelectItem>
                    <SelectItem value="hs_code">HS Code (6-digit)</SelectItem>
                    <SelectItem value="local_code">Local Tariff Code</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="flex items-center bg-background rounded-lg border p-1 shadow-sm w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setDirection('china_to_indonesia')}
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-md transition-colors flex-1 sm:flex-none",
                    direction === 'china_to_indonesia' ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted"
                  )}
                  data-testid="btn-dir-cn-id"
                >
                  China → Indonesia
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('indonesia_to_china')}
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-md transition-colors flex-1 sm:flex-none",
                    direction === 'indonesia_to_china' ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted"
                  )}
                  data-testid="btn-dir-id-cn"
                >
                  Indonesia → China
                </button>
              </div>

              <Button 
                type="submit" 
                size="lg" 
                className="w-full sm:w-auto font-semibold px-8 shadow-md"
                disabled={!query.trim() || searchMutation.isPending}
                data-testid="btn-submit-search"
              >
                {searchMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
                ) : (
                  "Map Classification"
                )}
              </Button>
            </div>
          </form>
        </div>
      </Card>

      {/* Results View */}
      <div className="min-h-[400px]">
        {searchMutation.isIdle && (
          <div className="h-[300px] flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-xl bg-card/50">
            <FileSearch className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-2">Ready for analysis</h3>
            <p className="text-sm text-muted-foreground/80 max-w-sm">
              Enter a trade description or code to map regulatory classifications across borders.
            </p>
          </div>
        )}
        
        {searchMutation.isPending && (
          <div className="h-[300px] flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary opacity-50" />
            <div className="text-sm font-medium text-muted-foreground">Correlating nomenclature...</div>
          </div>
        )}

        {searchMutation.isError && (
          <div className="p-6 border-l-4 border-destructive bg-destructive/10 text-destructive rounded-r-lg">
            <div className="flex items-center gap-2 font-semibold mb-2">
              <AlertTriangle className="w-5 h-5" /> Search failed
            </div>
            <p className="text-sm">Unable to complete classification mapping. Please try again or refine your query.</p>
          </div>
        )}

        {searchMutation.isSuccess && searchMutation.data && (
          <SearchResults
            result={searchMutation.data}
            onRefine={(details) => {
              searchMutation.mutate({
                data: { query: `${query} (${details})`, queryType, direction },
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

function SearchResults({ result, onRefine }: { result: TariffSearchResult; onRefine: (details: string) => void }) {
  if (result.matches.length === 0) {
    return (
      <div className="p-12 flex flex-col items-center justify-center border rounded-xl bg-card text-center">
        <Database className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-1">No correlations found</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          We couldn't map '{result.query}' to any confident counterparts. Try broadening your description or checking the 6-digit HS root.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-4">
          <h3 className="text-xl font-semibold">Classification Candidates</h3>
          <Badge variant="outline" className="bg-background text-muted-foreground font-mono">
            {result.matches.length} result{result.matches.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        
        <div className="flex items-center gap-3">
          {result.anchorHsCode && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-secondary/50 rounded-full border text-sm font-medium">
              <Anchor className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">HS Anchor:</span>
              <span className="font-mono text-foreground">{result.anchorHsCode}</span>
            </div>
          )}
          
          {result.manualReviewRequired && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-full border border-amber-500/30 text-sm font-semibold">
              <AlertTriangle className="w-4 h-4" />
              Manual Review Suggested
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs">
        <Badge variant="outline" className="font-mono">
          Margin {(result.candidate_margin * 100).toFixed(0)}%
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            "uppercase font-bold tracking-wider",
            result.ambiguity_level === 'low'
              ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400"
              : result.ambiguity_level === 'medium'
              ? "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400"
              : "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400"
          )}
        >
          {result.ambiguity_level} ambiguity
        </Badge>
      </div>

      {result.improvement_panel_visible && (
        <ImprovementPanel result={result} onRefine={onRefine} />
      )}

      <div className="grid gap-4">
        {result.matches.map((match: any, idx: number) => (
          <ResultCard key={`${match.matched_code}-${idx}`} match={match} rank={idx + 1} />
        ))}
      </div>
    </div>
  );
}

function ImprovementPanel({ result, onRefine }: { result: TariffSearchResult; onRefine: (details: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const reasons: string[] = [];
  if (result.manualReviewRequired) reasons.push('classification requires manual review');
  if (result.ambiguity_level === 'high') reasons.push('top candidates are too close to separate confidently');
  if (result.required_attributes.length > 0) reasons.push('national-extension-specific attributes are missing');

  const attributes = result.required_attributes;

  return (
    <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-4 space-y-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <div>
          <div className="font-semibold text-foreground">Improve classification precision</div>
          <p className="text-sm text-muted-foreground">
            {reasons.length > 0 ? `Why: ${reasons.join('; ')}.` : 'Provide a few more details to sharpen this result.'}
          </p>
        </div>
      </div>

      {attributes.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {attributes.map((attr) => {
            const options = result.attribute_options[attr];
            return (
              <div key={attr} className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{attr}</label>
                {options && options.length > 0 ? (
                  <Select value={answers[attr] ?? ''} onValueChange={(val) => setAnswers((a) => ({ ...a, [attr]: val }))}>
                    <SelectTrigger className="h-9 bg-background">
                      <SelectValue placeholder={`Select ${attr}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="h-9 bg-background"
                    placeholder={`e.g. ${attr}`}
                    value={answers[attr] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [attr]: e.target.value }))}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button
        size="sm"
        className="font-semibold"
        disabled={Object.values(answers).every((v) => !v.trim())}
        onClick={() => {
          const details = Object.values(answers).filter((v) => v.trim()).join(', ');
          if (details) onRefine(details);
        }}
        data-testid="btn-refine-classification"
      >
        Refine classification
      </Button>
    </div>
  );
}

function ResultCard({ match, rank }: { match: TariffSearchResult['matches'][0], rank: number }) {
  // Determine styling based on match label and confidence
  const isHighConfidence = match.match_confidence >= 0.8;
  const isReviewRequired = match.match_label === 'manual_review_required' || match.manual_review_required;
  
  const getBadgeColor = (label: string) => {
    switch (label) {
      case 'exact_match': return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400";
      case 'likely_match': return "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400";
      case 'partial_match': return "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400";
      case 'manual_review_required': return "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const formatLabel = (label: string) => label.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  return (
    <div className={cn(
      "rounded-lg border bg-card transition-all relative overflow-hidden",
      isReviewRequired ? "border-amber-500/40 shadow-sm" : "border-border shadow-sm hover:shadow-md",
      "flex flex-col md:flex-row"
    )}>
      {isReviewRequired && (
        <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
      )}
      
      {/* Left sidebar - Code & Confidence */}
      <div className="p-5 md:w-64 border-b md:border-b-0 md:border-r bg-muted/20 flex flex-col justify-between gap-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Candidate #{rank}</span>
            <div className="flex items-center gap-1.5 bg-background border px-2 py-0.5 rounded text-xs font-semibold shadow-sm">
              <GlobeIcon country={match.country} />
              <span className="capitalize">{match.country}</span>
            </div>
          </div>
          <div className="font-mono text-2xl font-bold tracking-tight text-foreground">{match.matched_code}</div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-muted-foreground">Match Confidence</span>
            <span className={cn(
              isHighConfidence ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-foreground font-semibold"
            )}>{(match.match_confidence * 100).toFixed(1)}%</span>
          </div>
          <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
            <div 
              className={cn(
                "h-full rounded-full",
                isHighConfidence ? "bg-emerald-500" : isReviewRequired ? "bg-amber-500" : "bg-primary"
              )}
              style={{ width: `${match.match_confidence * 100}%` }}
            />
          </div>
          <div className="pt-2 flex flex-wrap gap-1">
            <Badge variant="outline" className={cn("text-[10px] uppercase font-bold tracking-wider", getBadgeColor(match.match_label))}>
              {formatLabel(match.match_label)}
            </Badge>
            {match.source_status !== 'official tariff schedule' && (
              <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider bg-muted text-muted-foreground border-border">
                {match.source_status}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Main content - Description, Details, Explanation */}
      <div className="p-5 flex-1 flex flex-col">
        <div className="mb-4">
          <h4 className="font-semibold text-lg leading-snug mb-1">{match.description}</h4>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Info className="w-3.5 h-3.5" /> Source: {match.source_references.join('; ') || 'n/a'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          {match.tariff_rate ? (
            <div className="bg-background border rounded p-3">
              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1 tracking-wider">Statutory Rate</div>
              <div className="font-semibold">{match.tariff_rate}</div>
            </div>
          ) : (
            <div className="bg-background border rounded p-3">
              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1 tracking-wider">Statutory Rate</div>
              <div className="font-medium text-sm text-muted-foreground italic">{match.tariff_status}</div>
            </div>
          )}
          {match.tariff_note && (
            <div className="bg-background border rounded p-3">
              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1 tracking-wider">Note</div>
              <div className="font-medium text-sm text-foreground/90 line-clamp-2" title={match.tariff_note}>{match.tariff_note}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-5 gap-2 mb-4">
          {([
            ['Product type', match.reasoning.product_type_match],
            ['Function', match.reasoning.function_match],
            ['Attributes', match.reasoning.attribute_match],
            ['Text similarity', match.reasoning.text_semantic_similarity],
            ['Nat. extension', match.reasoning.national_extension_specificity],
          ] as const).map(([label, value]) => (
            <div key={label} className="bg-background border rounded p-2 text-center">
              <div className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider mb-0.5">{label}</div>
              <div className="text-sm font-semibold">{(value * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>

        {match.reasoning.conflicts.length > 0 && (
          <div className="mb-4 bg-destructive/10 border border-destructive/30 rounded p-3">
            <div className="text-[10px] uppercase font-bold text-destructive mb-1 tracking-wider">Conflict detected</div>
            {match.reasoning.conflicts.map((c, i) => (
              <p key={i} className="text-sm text-destructive/90">{c}</p>
            ))}
          </div>
        )}

        <div className="mt-auto pt-4 border-t border-dashed space-y-3">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 w-5 h-5 shrink-0 flex items-center justify-center rounded-full bg-secondary text-secondary-foreground">
              <CheckCircle className="w-3 h-3" />
            </div>
            <div>
              <div className="text-xs font-bold text-foreground mb-0.5 uppercase tracking-wider">
                Classification reasoning
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {match.reasoning.explanation}
              </p>
            </div>
          </div>
          {match.reasoning.ambiguity_note && (
            <p className="text-xs text-muted-foreground italic pl-7">{match.reasoning.ambiguity_note}</p>
          )}
          {match.reasoning.tariff_commentary && (
            <p className="text-xs text-muted-foreground italic pl-7">{match.reasoning.tariff_commentary}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function GlobeIcon({ country }: { country: string }) {
  if (country === 'china') return <span className="text-[10px]">🇨🇳</span>;
  if (country === 'indonesia') return <span className="text-[10px]">🇮🇩</span>;
  return <Globe className="w-3 h-3" />;
}

function Globe({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      <path d="M2 12h20"/>
    </svg>
  );
}

function ReferenceWorkspace() {
  const [countryFilter, setCountryFilter] = useState<Country | undefined>(undefined);
  
  const { data: codes, isLoading, isError } = useListTariffCodes(
    countryFilter ? { country: countryFilter } : undefined
  );

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Tariff Reference Library</h2>
          <p className="text-muted-foreground">Browse the seeded glossary of harmonized codes.</p>
        </div>
        
        <div className="flex items-center gap-2 bg-card border p-1 rounded-md shadow-sm">
          <button
            onClick={() => setCountryFilter(undefined)}
            className={cn("px-3 py-1.5 text-sm font-medium rounded transition-colors", !countryFilter ? "bg-secondary text-secondary-foreground" : "hover:bg-muted")}
          >
            All
          </button>
          <button
            onClick={() => setCountryFilter('china')}
            className={cn("px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-2", countryFilter === 'china' ? "bg-secondary text-secondary-foreground" : "hover:bg-muted")}
          >
            <GlobeIcon country="china" /> China
          </button>
          <button
            onClick={() => setCountryFilter('indonesia')}
            className={cn("px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-2", countryFilter === 'indonesia' ? "bg-secondary text-secondary-foreground" : "hover:bg-muted")}
          >
            <GlobeIcon country="indonesia" /> Indonesia
          </button>
        </div>
      </div>

      <Card className="border shadow-sm overflow-hidden bg-card">
        {isLoading && (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}
        
        {isError && (
          <div className="p-12 text-center text-destructive flex flex-col items-center">
            <AlertTriangle className="w-8 h-8 mb-2" />
            <p>Failed to load reference data</p>
          </div>
        )}

        {codes && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                <tr>
                  <th className="px-4 py-3 font-semibold">Code</th>
                  <th className="px-4 py-3 font-semibold">Country</th>
                  <th className="px-4 py-3 font-semibold">HS Anchor</th>
                  <th className="px-4 py-3 font-semibold w-1/3">Description</th>
                  <th className="px-4 py-3 font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {codes.map((code) => (
                  <tr key={`${code.country}-${code.code}`} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono font-medium whitespace-nowrap">{code.code}</td>
                    <td className="px-4 py-3 capitalize">{code.country}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{code.hsAnchor}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium line-clamp-2" title={code.description}>{code.description}</div>
                      {code.tariffNote && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-1">Note: {code.tariffNote}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap">
                      {code.tariffRate || <span className="text-muted-foreground/50">-</span>}
                    </td>
                  </tr>
                ))}
                {codes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No tariff codes found in reference data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
