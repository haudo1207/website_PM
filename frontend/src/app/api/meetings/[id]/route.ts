import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const dataFilePath = path.join(process.cwd(), 'data', 'meetings.json');

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getMeetings() {
  if (!fs.existsSync(dataFilePath)) return [];
  const fileContent = fs.readFileSync(dataFilePath, 'utf8');
  return JSON.parse(fileContent);
}

function saveMeetings(data: any) {
  fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function PUT(request: Request, context: any) {
  try {
    const params = await Promise.resolve(context.params);
    const body = await request.json();
    const meetings = getMeetings();
    const index = meetings.findIndex((m: any) => m.id === params.id);
    
    if (index === -1) {
      return NextResponse.json({ success: false, error: 'Meeting not found' }, { status: 404 });
    }
    
    meetings[index] = { ...meetings[index], ...body };
    saveMeetings(meetings);
    
    return NextResponse.json({ success: true, data: meetings[index] });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to update meeting' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: any) {
  try {
    const params = await Promise.resolve(context.params);
    const meetings = getMeetings();
    const filteredMeetings = meetings.filter((m: any) => m.id !== params.id);
    
    if (meetings.length === filteredMeetings.length) {
       return NextResponse.json({ success: false, error: 'Meeting not found' }, { status: 404 });
    }
    
    saveMeetings(filteredMeetings);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to delete meeting' }, { status: 500 });
  }
}
