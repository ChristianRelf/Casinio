import { BlackjackTable } from "../../../components/game/BlackjackTable";
export default async function TablePage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <BlackjackTable tableId={id}/>}
