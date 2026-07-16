import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border/60 flex flex-wrap items-center gap-3 border-b py-5">
      <span className="text-muted-foreground w-28 shrink-0 font-mono text-xs">
        {label}
      </span>
      {children}
    </div>
  );
}

export default function StyleguidePrimitives() {
  return (
    <TooltipProvider>
      <div>
        <Row label="Button">
          <Button>Start tracking</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </Row>

        <Row label="Badge">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Loss</Badge>
        </Row>

        <Row label="Input">
          <Input placeholder="you@email.com" className="max-w-xs" />
        </Row>

        <Row label="Tabs">
          <Tabs defaultValue="net" className="w-full max-w-sm">
            <TabsList>
              <TabsTrigger value="net">Net worth</TabsTrigger>
              <TabsTrigger value="spend">Spending</TabsTrigger>
              <TabsTrigger value="invest">Invest</TabsTrigger>
            </TabsList>
            <TabsContent value="net" className="text-muted-foreground pt-3 text-sm">
              Every account, one number.
            </TabsContent>
            <TabsContent value="spend" className="text-muted-foreground pt-3 text-sm">
              Where each month goes.
            </TabsContent>
            <TabsContent value="invest" className="text-muted-foreground pt-3 text-sm">
              Allocation and performance.
            </TabsContent>
          </Tabs>
        </Row>

        <Row label="Tooltip">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>Tabular, timestamped, yours.</TooltipContent>
          </Tooltip>
        </Row>

        <Row label="Accordion">
          <Accordion type="single" collapsible className="w-full max-w-sm">
            <AccordionItem value="a">
              <AccordionTrigger>Is my data safe?</AccordionTrigger>
              <AccordionContent>
                Read-only access, encrypted end to end.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="b">
              <AccordionTrigger>Can I cancel?</AccordionTrigger>
              <AccordionContent>Anytime, in one click.</AccordionContent>
            </AccordionItem>
          </Accordion>
        </Row>
      </div>
    </TooltipProvider>
  );
}
