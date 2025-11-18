"use client";
import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

export interface SalesChartProps {
  labels: string[];
  values: number[];
}

export default function SalesChartLazy({ labels, values }: SalesChartProps) {
  const data = {
    labels,
    datasets: [
      {
        label: 'Sales Amount',
        data: values,
        backgroundColor: 'rgba(14, 165, 233, 0.8)',
        borderColor: 'rgba(14, 165, 233, 1)',
        borderWidth: 2,
        borderRadius: 6,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        padding: 12,
        cornerRadius: 8,
        titleFont: { size: 14, weight: 600 },
        bodyFont: { size: 13, weight: 400 },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(148, 163, 184, 0.1)' },
        ticks: { color: '#64748b', font: { size: 11 } },
      },
      x: {
        grid: { display: false },
        ticks: { color: '#64748b', font: { size: 11 } },
      },
    },
  } as const;

  return <Bar data={data} options={options} />;
}
