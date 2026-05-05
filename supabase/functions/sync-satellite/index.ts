import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const bridgeToken = Deno.env.get('SUPABASE_BRIDGE_TOKEN');
    
    // Verify authorization if token is set in env
    if (bridgeToken) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader || authHeader !== `Bearer ${bridgeToken}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const payload = await req.json();
    const { spreadsheet_id, spreadsheet_name, bridge_version, tabs } = payload;

    if (!spreadsheet_id || !tabs) {
      return new Response(JSON.stringify({ error: 'Missing spreadsheet_id or tabs in payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase URL or Service Key');
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find satellite by sheet_id
    const { data: satData, error: satError } = await supabase
      .from('satellites')
      .select('id')
      .eq('sheet_id', spreadsheet_id)
      .single();

    if (satError && satError.code !== 'PGRST116') {
      console.error('Error finding satellite:', satError);
    }
    
    const satellite_id = satData ? satData.id : null;

    // Process tabs
    const tabs_received: string[] = [];
    const row_counts: Record<string, number> = {};
    
    for (const [tabName, values] of Object.entries(tabs)) {
      if (values && Array.isArray(values) && values.length > 0) {
        tabs_received.push(tabName);
        row_counts[tabName] = values.length;
        
        // Insert snapshot
        const { error: snapError } = await supabase
          .from('satellite_tab_snapshots')
          .insert({
            satellite_id,
            sheet_id: spreadsheet_id,
            tab_name: tabName,
            values_json: values,
            row_count: values.length,
            col_count: Array.isArray(values[0]) ? values[0].length : 0,
            bridge_version
          });
          
        if (snapError) {
          console.error(`Error inserting snapshot for ${tabName}:`, snapError);
        }
      }
    }

    // Insert sync event
    const { error: eventError } = await supabase
      .from('satellite_sync_events')
      .insert({
        satellite_id,
        sheet_id: spreadsheet_id,
        spreadsheet_name,
        bridge_version,
        status: 'success',
        tabs_received,
        row_counts
      });

    if (eventError) {
      console.error('Error inserting sync event:', eventError);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sheet_id: spreadsheet_id,
        satellite_id,
        tabs_received,
        row_counts
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Processing error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
